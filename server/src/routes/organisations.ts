import { FastifyInstance, FastifyReply } from 'fastify';
import {
  createOrganisation,
  getOrganisation,
  listOrganisations,
  updateOrganisation,
  deleteOrganisation,
  addOrganisationMember,
  addOrganisationMemberByEmail,
  removeOrganisationMember,
  getOrganisationMembers,
  getOrganisationsForUser,
  getOrganisationAccountByOrganisation,
  updateOrganisationAccount,
  reconcileOrganisationPendingMembers,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess, isSuperAdmin, authenticateWithJwtFromHeader } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import {
	getOrCreateStripeCustomer,
	createCheckoutSession,
	createOrUpdateSubscription,
	getCustomerPortalUrl,
	getSubscription,
} from '../services/stripe.js';
import { getUser } from '../db/db_sql.js';
import Stripe from 'stripe';
import { checkOrganisationAccess, getPlanPrice } from './route_helpers.js';

/**
 * Check if the user is a member of the organisation and has admin role.
 * Uses member_settings to determine admin status. If no one in member_settings has role:admin,
 * then any member can admin (to avoid lockout).
 * Returns true if access is allowed, false if denied (and 401 / 403 reply is sent).
 */
async function checkOrganisationAdminAccess(
  request: AuthenticatedRequest,
  reply: FastifyReply,
  organisationId: string
): Promise<boolean> {
  if (!request.userId) {
    reply.code(401).send({ error: 'User ID not found in authenticated request' });
    return false;
  }

  const org = await getOrganisation(organisationId);
  if (!org) {
    reply.code(404).send({ error: 'Organisation not found' });
    return false;
  }

  // Check if user is a member
  if (!org.members || !org.members.includes(request.userId)) {
    reply.code(403).send({ error: 'User is not a member of this organisation' });
    return false;
  }

  // Check if user has admin role via API key (JWT users always have admin)
  if (request.authenticatedWith === 'api_key' && request.apiKey) {
    // API key with admin role always has access
    if (request.apiKey.role === 'admin') {
      return true;
    } else {
      reply.code(403).send({ error: 'API key does not have admin role' });
      return false;
    }
  }

  // Check memberSettings for admin role
  const memberSettings = org.memberSettings || {};
  const userSettings = memberSettings[request.userId];
  
  // Check if any member has admin role in memberSettings
  const hasAnyAdmin = Object.values(memberSettings).some(
    (settings: any) => settings && settings.role === 'admin'
  );

  // If no one has admin role, allow any member to admin (avoid lockout)
  if (!hasAnyAdmin) {
    return true;
  }

  // Otherwise, user must have admin role in member_settings
  if (userSettings && userSettings.role === 'admin') {
    return true;
  }

  reply.code(403).send({ error: 'Admin role required to manage organisation members' });
  return false;
}

/**
 * Register organisation endpoints with Fastify
 */
export async function registerOrganisationRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Security: Authenticated users only (via authenticate middleware). No organisation membership check - any authenticated user can create organisations.
  fastify.post('/organisation', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const org = await createOrganisation(request.body as any);
    return org;
  });

  // Security: Authenticated users only. No membership check - any authenticated user can view any organisation by ID.
  fastify.get('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id } = request.params as { id: string };
    let org = await getOrganisation(id);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    org = await reconcileOrganisationPendingMembers(org);
    return org;
  });

  // List organisations for user
  // Security: Authenticated users only. Filtered to only return organisations where user is a member (via getOrganisationsForUser in endpoint handler).
  fastify.get('/organisation', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const query = (request.query as any).q as string | undefined;
    const searchQuery = query ? new SearchQuery(query) : null;
    if (!request.userId) {
      reply.code(401).send({ error: 'User ID not found in authenticated request' });
      return;
    }
    let orgs = await getOrganisationsForUser(request.userId, searchQuery);
    orgs = await Promise.all(orgs.map((org) => reconcileOrganisationPendingMembers(org)));
    return orgs;
  });

  // Security: Authenticated users only. No membership check - any authenticated user can update any organisation by ID.
  fastify.put('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id } = request.params as { id: string };
    const org = await updateOrganisation(id, request.body as any);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    return org;
  });

  // Security: Authenticated users only. No membership check - any authenticated user can delete any organisation by ID.
  fastify.delete('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['admin'])) return;
    const { id } = request.params as { id: string };
    const deleted = await deleteOrganisation(id);
    if (!deleted) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    return { success: true };
  });

  // ===== ORGANISATION MEMBER ENDPOINTS =====
  // Security: User must be a member of the organisation and have admin role (via memberSettings or API key).
  // If no one has admin role in memberSettings, any member can admin (to avoid lockout).
  fastify.post('/organisation/:organisationId/member/:userId', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { organisationId, userId } = request.params as { organisationId: string; userId: string };
    if (!(await checkOrganisationAdminAccess(request, reply, organisationId))) return;
    const organisation = await addOrganisationMember(organisationId, userId);
    return organisation;
  });

  // Add member by email: if user exists (case-insensitive), add to members; else add to pending.
  fastify.post('/organisation/:organisationId/member', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { organisationId } = request.params as { organisationId: string };
    if (!(await checkOrganisationAdminAccess(request, reply, organisationId))) return;
    const body = request.body as { email?: string };
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!email) {
      reply.code(400).send({ error: 'email is required' });
      return;
    }
    const result = await addOrganisationMemberByEmail(organisationId, email);
    if (result.kind === 'notFound') {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    if (result.kind === 'alreadyMember') {
      reply.code(400).send({ error: 'User is already a member of this organisation' });
      return;
    }
    if (result.kind === 'alreadyPending') {
      reply.code(400).send({ error: 'This email is already pending invitation' });
      return;
    }
    return result.org;
  });

  // Security: User must be a member of the organisation and have admin role (via memberSettings or API key).
  // If no one has admin role in memberSettings, any member can admin (to avoid lockout).
  fastify.delete('/organisation/:organisationId/member/:userId', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { organisationId, userId } = request.params as { organisationId: string; userId: string };
    if (!(await checkOrganisationAdminAccess(request, reply, organisationId))) return;
    const deleted = await removeOrganisationMember(organisationId, userId);
    if (!deleted) {
      reply.code(404).send({ error: 'Member not found' });
      return;
    }
    return { success: true };
  });

  // Security: Authenticated users only. No membership check - any authenticated user can view members of any organisation.
  fastify.get('/organisation/:organisationId/member', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { organisationId } = request.params as { organisationId: string };
    const members = await getOrganisationMembers(organisationId);
    return members;
  });


  // ===== STRIPE SUBSCRIPTION ENDPOINTS =====

  // Create Stripe checkout session
  // Security: Organisation members only
  fastify.post('/organisation/:organisationId/subscription/checkout', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    
    const { organisationId } = request.params as { organisationId: string };
    const body = request.body as { planType: 'free' | 'pro' | 'enterprise' };
    
    const access = await checkOrganisationAccess(request, reply, organisationId);
    if (!access) return;
    const { isSuper } = access;
    
    // Enterprise plans are manually priced and must be set by super-admin
    if (body.planType === 'enterprise') {
      if (!isSuper) {
        reply.code(403).send({ error: 'Enterprise plans must be set by super-admin. Please contact support.' });
        return;
      }
      reply.code(400).send({ error: 'Enterprise plans should be set via the update endpoint with a custom price' });
      return;
    }
    
    // Get price ID for plan
    const priceIdMap: Record<string, string> = {
      free: process.env.STRIPE_PRICE_ID_FREE || '',
      pro: process.env.STRIPE_PRICE_ID_PRO || '',
    };
    
    const priceId = priceIdMap[body.planType];
    if (!priceId && body.planType !== 'free') {
      reply.code(400).send({ error: `Price ID not configured for plan: ${body.planType}` });
      return;
    }
    
    if (body.planType === 'free') {
      // For free plan, update subscription directly without checkout
      const account = await getOrganisationAccountByOrganisation(organisationId);
      if (!account) {
        reply.code(404).send({ error: 'OrganisationAccount not found' });
        return;
      }
      
      const user = await getUser(request.userId!);
      const { customerId, subscriptionId } = await createOrUpdateSubscription(
        organisationId,
        'free',
        account,
        user?.email,
        false
      );
      
      await updateOrganisationAccount(account.id, {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId || undefined,
        subscription: {
          ...account.subscription,
          type: 'free',
          pricePerMonth: 0,
        },
      });
      
      return { success: true, planType: 'free' };
    }
    
    // Check if Stripe is configured before creating checkout session
    if (!process.env.STRIPE_SECRET_KEY) {
      reply.code(503).send({ error: 'Payment processing is not configured. Please contact support.' });
      return;
    }
    
    // Get user email - try from database first, then from JWT token
    const user = await getUser(request.userId!);
    let userEmail = user?.email;
    
    // If user doesn't have email in database, try to get it from JWT token
    if (!userEmail && request.authenticatedWith === 'jwt') {
      const jwtResult = await authenticateWithJwtFromHeader(request);
      if (jwtResult?.email) {
        userEmail = jwtResult.email;
      }
    }
    
    if (!userEmail) {
      reply.code(400).send({ error: 'User email is required to create a checkout session. Please ensure your account has an email address.' });
      return;
    }
    
    const { url } = await createCheckoutSession(organisationId, priceId, userEmail);
    return { checkoutUrl: url };
  });

  // Update subscription (for super admin or after Stripe payment)
  // Security: Super admin or organisation members
  fastify.post('/organisation/:organisationId/subscription/update', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    
    const { organisationId } = request.params as { organisationId: string };
    const body = request.body as {
      planType: 'free' | 'pro' | 'enterprise';
      noPaymentNeeded?: boolean;
      pricePerMonth?: number; // For enterprise, allow custom price
    };
    
    const access = await checkOrganisationAccess(request, reply, organisationId);
    if (!access) return;
    const { isSuper } = access;
    
    // Enterprise plans require super-admin
    if (body.planType === 'enterprise' && !isSuper) {
      reply.code(403).send({ error: 'Enterprise plans can only be set by super-admin' });
      return;
    }
    
    // Only super admin can use noPaymentNeeded
    const noPaymentNeeded = isSuper && body.noPaymentNeeded === true;
    
    const account = await getOrganisationAccountByOrganisation(organisationId);
    if (!account) {
      reply.code(404).send({ error: 'OrganisationAccount not found' });
      return;
    }
    
    const user = await getUser(request.userId!);
    const userEmail = user?.email;
    
    // For enterprise, we don't create a Stripe subscription (manually managed)
    // For other plans, create/update Stripe subscription
    let customerId = account.stripeCustomerId;
    let subscriptionId = account.stripeSubscriptionId;
    
    if (body.planType !== 'enterprise') {
      const result = await createOrUpdateSubscription(
        organisationId,
        body.planType,
        account,
        userEmail,
        noPaymentNeeded
      );
      customerId = result.customerId;
      subscriptionId = result.subscriptionId;
    } else {
      // For enterprise, get or create customer but don't create subscription
      // Enterprise subscriptions are managed outside Stripe (manual billing)
      if (!customerId && userEmail) {
        try {
          customerId = await getOrCreateStripeCustomer(organisationId, userEmail);
        } catch (error) {
          // If Stripe is not configured, that's okay for enterprise (manual billing)
          fastify.log.warn('Stripe not configured, skipping customer creation for enterprise plan');
        }
      }
      subscriptionId = undefined;
    }
    
    // Calculate price based on plan
    const pricePerMonth = getPlanPrice(body.planType, noPaymentNeeded, body.pricePerMonth) || 
      (body.planType === 'enterprise' ? (account.subscription?.pricePerMonth || 0) : 0);
    
    const updated = await updateOrganisationAccount(account.id, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId || undefined,
      subscription: {
        ...account.subscription,
        type: body.planType,
        pricePerMonth: pricePerMonth,
        start: new Date(),
      },
    });
    
    if (!updated) {
      reply.code(404).send({ error: 'Failed to update OrganisationAccount' });
      return;
    }
    
    return updated;
  });

  // Get customer portal URL for managing billing
  // Security: Organisation members only
  fastify.get('/organisation/:organisationId/subscription/portal', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    
    const { organisationId } = request.params as { organisationId: string };
    
    const access = await checkOrganisationAccess(request, reply, organisationId);
    if (!access) return;
    
    const account = await getOrganisationAccountByOrganisation(organisationId);
    if (!account || !account.stripeCustomerId) {
      reply.code(404).send({ error: 'Stripe customer not found. Please create a subscription first.' });
      return;
    }
    
    const baseUrl = process.env.WEBAPP_URL || 'http://localhost:4000';
    const returnUrl = `${baseUrl}/organisation/${organisationId}/account`;
    const portalUrl = await getCustomerPortalUrl(account.stripeCustomerId, returnUrl);
    
    return { url: portalUrl };
  });

  // Stripe webhook handler (no authentication - uses Stripe signature verification)
  // Note: For production, consider using @fastify/raw-body plugin for proper raw body handling
  // For now, we use a workaround: read raw body in preHandler before Fastify parses it
  fastify.post('/stripe/webhook', {
    preHandler: async (request: any, reply) => {
      // Read raw body before Fastify parses it
      return new Promise<void>((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.raw.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        request.raw.on('end', () => {
          request.rawBody = Buffer.concat(chunks);
          resolve();
        });
        request.raw.on('error', (err: Error) => {
          reject(err);
        });
      });
    },
  } as any, async (request: any, reply) => {
    const webhookStripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookStripeSecretKey || !webhookSecret) {
      reply.code(500).send({ error: 'Stripe not configured' });
      return;
    }
    
    const webhookStripe = new Stripe(webhookStripeSecretKey, { apiVersion: '2025-02-24.acacia' });
    const webhookSig = (request.headers['stripe-signature'] as string) || '';
    const webhookRawBody = request.rawBody;
    
    if (!webhookRawBody) {
      reply.code(400).send({ error: 'Missing request body' });
      return;
    }
    
    const webhookBodyString = Buffer.isBuffer(webhookRawBody) ? webhookRawBody.toString('utf8') : webhookRawBody;
    
    let event: Stripe.Event;
    
    try {
      event = webhookStripe.webhooks.constructEvent(webhookBodyString, webhookSig, webhookSecret);
    } catch (err) {
      const error = err as Error;
      fastify.log.error(`Webhook signature verification failed: ${error.message}`);
      reply.code(400).send({ error: `Webhook Error: ${error.message}` });
      return;
    }
    
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const organisationId = session.metadata?.organisation_id;
        
        if (organisationId && session.subscription) {
          const account = await getOrganisationAccountByOrganisation(organisationId);
          if (account) {
            const subscription = await getSubscription(session.subscription as string);
            if (subscription) {
              const planType = subscription.metadata?.plan_type || 'pro';
              await updateOrganisationAccount(account.id, {
                stripeCustomerId: session.customer as string,
                stripeSubscriptionId: session.subscription as string,
                subscription: {
                  ...account.subscription,
                  type: planType as 'free' | 'pro' | 'enterprise',
                  status: 'active',
                  start: new Date(subscription.current_period_start * 1000),
                  end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
                  renewal: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
                },
              });
            }
          }
        }
        break;
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const organisationId = subscription.metadata?.organisation_id;
        
        if (organisationId) {
          const account = await getOrganisationAccountByOrganisation(organisationId);
          if (account && account.stripeSubscriptionId === subscription.id) {
            const planType = subscription.metadata?.plan_type || account.subscription.type;
            await updateOrganisationAccount(account.id, {
              subscription: {
                ...account.subscription,
                type: planType as 'free' | 'pro' | 'enterprise',
                status: subscription.status === 'active' ? 'active' : 'closed',
                end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
                renewal: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
              },
            });
          }
        }
        break;
      }
    }
    
    reply.send({ received: true });
  });
}

