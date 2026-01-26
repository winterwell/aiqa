/**
 * Stripe service for managing subscriptions and billing.
 */

import Stripe from 'stripe';
import { getOrganisation, getUser } from '../db/db_sql.js';
import OrganisationAccount from '../common/types/OrganisationAccount.js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
	console.warn('STRIPE_SECRET_KEY not set. Stripe functionality will be disabled.');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2025-02-24.acacia' }) : null;

// Stripe price IDs for different plans (set via environment variables)
// Note: Enterprise doesn't use Stripe pricing (manually managed)
const STRIPE_PRICE_IDS: Record<'free' | 'pro', string> = {
	free: process.env.STRIPE_PRICE_ID_FREE || '',
	pro: process.env.STRIPE_PRICE_ID_PRO || '',
};

/**
 * Get or create a Stripe customer for an organisation.
 */
export async function getOrCreateStripeCustomer(
	organisationId: string,
	userEmail?: string
): Promise<string | null> {
	if (!stripe) {
		throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
	}

	const org = await getOrganisation(organisationId);
	if (!org) {
		throw new Error('Organisation not found');
	}

	// Try to get email from user if not provided
	if (!userEmail && org.members && org.members.length > 0) {
		const firstUser = await getUser(org.members[0]);
		if (firstUser?.email) {
			userEmail = firstUser.email;
		}
	}

	if (!userEmail) {
		throw new Error('User email is required to create Stripe customer');
	}

	// Check if customer already exists in Stripe (we'll search by email)
	const customers = await stripe.customers.list({
		email: userEmail,
		limit: 1,
	});

	if (customers.data.length > 0) {
		return customers.data[0].id;
	}

	// Create new customer
	const customer = await stripe.customers.create({
		email: userEmail,
		name: org.name,
		metadata: {
			organisation_id: organisationId,
		},
	});

	return customer.id;
}

/**
 * Create a Stripe checkout session for subscription.
 */
export async function createCheckoutSession(
	organisationId: string,
	priceId: string,
	userEmail?: string
): Promise<{ sessionId: string; url: string }> {
	if (!stripe) {
		throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
	}

	const customerId = await getOrCreateStripeCustomer(organisationId, userEmail);

	const baseUrl = process.env.WEBAPP_URL || 'http://localhost:4000';
	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		payment_method_types: ['card'],
		line_items: [
			{
				price: priceId,
				quantity: 1,
			},
		],
		mode: 'subscription',
		success_url: `${baseUrl}/organisation/${organisationId}/account?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${baseUrl}/organisation/${organisationId}/account`,
		metadata: {
			organisation_id: organisationId,
		},
	});

	return {
		sessionId: session.id,
		url: session.url || '',
	};
}

/**
 * Create or update a Stripe subscription for an organisation.
 * If noPaymentNeeded is true, creates a subscription with $0 amount.
 */
export async function createOrUpdateSubscription(
	organisationId: string,
	planType: 'free' | 'pro' | 'enterprise',
	account: OrganisationAccount,
	userEmail?: string,
	noPaymentNeeded: boolean = false
): Promise<{ customerId: string; subscriptionId: string }> {
	if (!stripe) {
		throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
	}

	// Enterprise plans don't use Stripe subscriptions (manually managed)
	if (planType === 'enterprise') {
		const customerId = account.stripe_customer_id || await getOrCreateStripeCustomer(organisationId, userEmail);
		return { customerId, subscriptionId: '' };
	}

	const customerId = account.stripe_customer_id || await getOrCreateStripeCustomer(organisationId, userEmail);
	let subscriptionId = account.stripe_subscription_id;

	// Free plans don't create Stripe subscriptions
	if (planType === 'free') {
		return { customerId, subscriptionId: '' };
	}

	// Pro plan requires Stripe subscription
	const priceId = STRIPE_PRICE_IDS[planType];
	if (!priceId && !noPaymentNeeded) {
		throw new Error(`Price ID not configured for plan: ${planType}`);
	}

	if (subscriptionId && !noPaymentNeeded) {
		// Update existing subscription to new price
		const subscription = await stripe.subscriptions.retrieve(subscriptionId);
		await stripe.subscriptions.update(subscriptionId, {
			items: [
				{
					id: subscription.items.data[0].id,
					price: priceId,
				},
			],
		});
		return { customerId, subscriptionId };
	}

	// Cancel existing subscription if switching to no-payment
	if (subscriptionId && noPaymentNeeded) {
		await stripe.subscriptions.cancel(subscriptionId);
		subscriptionId = undefined;
	}

	// Create new subscription (only for Pro with payment)
	if (!noPaymentNeeded && priceId) {
		const subscription = await stripe.subscriptions.create({
			customer: customerId,
			items: [{ price: priceId }],
			metadata: {
				organisation_id: organisationId,
				plan_type: planType,
				no_payment: 'false',
			},
		});
		subscriptionId = subscription.id;
	}

	return {
		customerId,
		subscriptionId: subscriptionId || '',
	};
}

/**
 * Retrieve a Stripe subscription by ID.
 */
export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
	if (!stripe) {
		return null;
	}

	try {
		return await stripe.subscriptions.retrieve(subscriptionId);
	} catch (error) {
		console.error('Error retrieving Stripe subscription:', error);
		return null;
	}
}

/**
 * Cancel a Stripe subscription.
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
	if (!stripe) {
		throw new Error('Stripe is not configured.');
	}

	await stripe.subscriptions.cancel(subscriptionId);
}

/**
 * Get the Stripe customer portal URL for managing billing.
 */
export async function getCustomerPortalUrl(
	customerId: string,
	returnUrl: string
): Promise<string> {
	if (!stripe) {
		throw new Error('Stripe is not configured.');
	}

	const session = await stripe.billingPortal.sessions.create({
		customer: customerId,
		return_url: returnUrl,
	});

	return session.url;
}
