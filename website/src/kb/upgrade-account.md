---
layout: base.html
title: Upgrade your account - AIQA
permalink: /kb/upgrade-account.html
---

<div class="container py-5">
<div class="row">
<div class="col-lg-8 mx-auto">

<p class="text-muted mb-4"><a href="/kb/">Help</a> · Upgrade your account</p>

# Upgrade your account

Subscriptions are per organisation, not per person. Plans: **Free**, **Pro** ($29/month), and **Enterprise** (custom, billed separately).

## As a user

1. Open your organisation, then go to **Account** (avatar menu, or the Account button on the org page).
2. Click **Change Subscription**.
3. Choose **Pro**, then **Continue to Payment**. You will be sent to Stripe to pay.
4. Use **Billing & Invoices** to manage cards, invoices, or cancel.

Enterprise is not available in that dropdown unless you are a super admin.

## As an admin

You are a super admin if you are a member of the **AIQA** organisation.

- On the same **Account** page you can set **Enterprise**, or tick **No payment needed** to change Free / Pro / Enterprise without Stripe.
- Or open Admin Settings at `/organisation/{orgId}/admin` (not in the nav). Set the plan there, plus rate limit, retention, and other thresholds. This writes the plan directly, with no Stripe checkout.

<p class="mt-5"><a href="/kb/">← Help</a></p>

</div>
</div>
</div>
