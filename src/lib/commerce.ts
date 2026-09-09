import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { z } from 'zod';
import { HttpError } from './auth';
import { readBoundedBody } from './email';
import { readDocument, updateDocument } from './durable-store';
import { configuredStripeMode, hasPaidAccess, memberSignInReady, publicOrigin } from './members';
import { COMMERCE_DOCUMENT, initialCommerce, type CommerceData, type CommerceReadiness, type Member, type SubscriptionStatus } from './commerce-types';

export const STRIPE_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'] as const;
const idOf = (value: string | { id: string } | null | undefined): string | null => typeof value === 'string' ? value : value?.id || null;

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_(live|test)_/.test(key)) throw new HttpError('Billing is awaiting payment configuration.', 503);
  return new Stripe(key, { timeout: 15_000, maxNetworkRetries: 1 });
}

export async function getCommerceReadiness(): Promise<CommerceReadiness> {
  const { settings } = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  const key = process.env.STRIPE_SECRET_KEY || '';
  const mode = /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : 'unconfigured';
  const stripeConfigured = mode !== 'unconfigured';
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'));
  const priceConfigured = Boolean(settings.priceId && settings.monthlyAmount && settings.priceValidatedAt && settings.priceLivemode === (mode === 'live'));
  const signInReady = memberSignInReady();
  const blockers: string[] = [];
  if (!settings.liveSalesEnabled) blockers.push('Sales are closed by the owner.');
  if (!stripeConfigured) blockers.push('Stripe is not connected.');
  if (!webhookConfigured) blockers.push('Stripe subscription updates are not configured.');
  if (!priceConfigured) blockers.push('The owner must select and validate a monthly AUD price.');
  if (!signInReady) blockers.push('Secure member email sign-in is not configured.');
  return { salesOpen: blockers.length === 0, memberSignInReady: signInReady, stripeConfigured, webhookConfigured, priceConfigured, liveSalesEnabled: settings.liveSalesEnabled, monthlyAmount: settings.monthlyAmount, currency: 'aud', mode, blockers };
}

export async function getCommerceSettings() {
  const data = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  return { settings: data.settings, readiness: await getCommerceReadiness(), memberCount: Object.keys(data.members).length, paidMemberCount: Object.values(data.members).filter(hasPaidAccess).length };
}

async function validatePrice(priceId: string, stripe: Stripe) {
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  const product = price.product;
  if (!price.active || price.type !== 'recurring' || price.currency !== 'aud' || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed' || price.billing_scheme !== 'per_unit' || !price.unit_amount || price.unit_amount < 1 || typeof product === 'string' || product.deleted || !product.active || price.custom_unit_amount || price.transform_quantity) throw new HttpError('Select an active fixed monthly AUD subscription price with one licensed unit.', 400);
  if (price.livemode !== /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '')) throw new HttpError('The selected price does not match the configured Stripe mode.', 400);
  return price;
}

export async function updateCommerceSettings(input: unknown, stripe?: Stripe) {
  const change = z.object({ priceId: z.string().regex(/^price_[A-Za-z0-9]+$/).nullable().optional(), liveSalesEnabled: z.boolean().optional() }).strict().parse(input);
  const existing = (await readDocument(COMMERCE_DOCUMENT, initialCommerce)).settings;
  const requestedPrice = change.priceId === undefined ? existing.priceId : change.priceId;
  let validated: Awaited<ReturnType<typeof validatePrice>> | null = null;
  if (requestedPrice && (change.priceId !== undefined || change.liveSalesEnabled === true)) validated = await validatePrice(requestedPrice, stripe || stripeClient());
  if (change.liveSalesEnabled === true) {
    if (!requestedPrice || !validated) throw new HttpError('Validate the monthly subscription price before opening sales.', 409);
    if (!memberSignInReady() || !process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new HttpError('Complete member sign-in and Stripe webhook setup before opening sales.', 409);
  }
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
    // Prevent a stale owner request from reopening sales with a concurrently changed price.
    if (data.settings.updatedAt !== existing.updatedAt) throw new HttpError('Billing settings changed. Refresh and try again.', 409);
    if (change.priceId !== undefined) {
      data.settings.priceId = requestedPrice;
      data.settings.liveSalesEnabled = false;
      if (!requestedPrice) { data.settings.monthlyAmount = null; data.settings.priceLivemode = null; data.settings.priceValidatedAt = null; }
    }
    if (validated) {
      data.settings.monthlyAmount = validated.unit_amount;
      data.settings.priceLivemode = validated.livemode;
      data.settings.priceValidatedAt = new Date().toISOString();
      data.settings.approvedPriceIds = [...new Set([...data.settings.approvedPriceIds, validated.id])];
    }
    if (change.liveSalesEnabled !== undefined) data.settings.liveSalesEnabled = change.liveSalesEnabled;
    data.settings.updatedAt = new Date().toISOString();
  });
  if (change.liveSalesEnabled === false || (change.priceId !== undefined && change.priceId !== existing.priceId)) {
    const pending = (await readDocument(COMMERCE_DOCUMENT, initialCommerce)).checkoutSessions;
    const open = Object.entries(pending || {}).filter(([, checkout]) => checkout.id && checkout.expires > Date.now() && (change.liveSalesEnabled === false || checkout.priceId !== requestedPrice));
    if (open.length) {
      const provider = stripe || stripeClient();
      for (const [memberId, checkout] of open) {
        try {
          const remote = await provider.checkout.sessions.retrieve(checkout.id!);
          if (remote.status === 'open') await provider.checkout.sessions.expire(checkout.id!);
          await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { if (data.checkoutSessions[memberId]?.id === checkout.id) delete data.checkoutSessions[memberId]; });
        } catch {
          await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.settings.liveSalesEnabled = false; });
          throw new HttpError('Settings were saved with sales closed, but an existing checkout could not be expired. Retry closing sales to finish.', 503);
        }
      }
    }
  }
  return getCommerceSettings();
}

async function withMemberLease<T>(memberId: string, operation: (token: string) => Promise<T>): Promise<T> {
  const token = randomUUID();
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
    if (!data.members[memberId]) throw new HttpError('Member account not found.', 404);
    if ((data.leases[memberId]?.expires || 0) > Date.now()) throw new HttpError('Your billing account is updating. Please try again shortly.', 503);
    data.leases[memberId] = { token, expires: Date.now() + 180_000 };
  });
  try { return await operation(token); }
  finally { await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { if (data.leases[memberId]?.token === token) delete data.leases[memberId]; }); }
}

function checkLease(data: CommerceData, memberId: string, token: string) {
  if (data.leases[memberId]?.token !== token || data.leases[memberId].expires <= Date.now()) throw new HttpError('Billing update expired. Please retry.', 503);
}

/** Read canonical Stripe state inside the durable member lease; event payloads never grant access. */
async function canonicalSubscription(member: Member, approvedPriceIds: string[], stripe: Stripe): Promise<Member['subscription']> {
  const empty: Member['subscription'] = { id: null, status: 'none', paidThrough: null, cancelAtPeriodEnd: false, latestInvoiceId: null, reconciledAt: new Date().toISOString() };
  if (!member.stripeCustomerId) return empty;
  const list = await stripe.subscriptions.list({ customer: member.stripeCustomerId, status: 'all', limit: 100, expand: ['data.latest_invoice'] });
  if (list.has_more) throw new HttpError('This billing account needs an editor review before its access can update.', 503);
  const expectedMode = configuredStripeMode();
  const relevant = list.data.filter(subscription => expectedMode && subscription.livemode === (expectedMode === 'live') && idOf(subscription.customer) === member.stripeCustomerId && subscription.metadata.memberId === member.id && subscription.items.data.length === 1 && approvedPriceIds.includes(subscription.items.data[0].price.id));
  if (relevant.length > 10) throw new HttpError('This billing account needs an editor review before its access can update.', 503);
  const snapshots: Array<Member['subscription'] & { created: number }> = [];
  for (const subscription of relevant) {
    let status: SubscriptionStatus = ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'].includes(subscription.status) ? subscription.status as SubscriptionStatus : 'payment_pending';
    const end = status === 'trialing' ? subscription.trial_end : subscription.items.data[0].current_period_end;
    const invoice = typeof subscription.latest_invoice === 'string' ? await stripe.invoices.retrieve(subscription.latest_invoice) : subscription.latest_invoice;
    if (status === 'active') {
      if (!invoice || invoice.status !== 'paid') status = 'payment_pending';
      else if (invoice.amount_paid > 0) {
        const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 100 });
        if (payments.has_more) throw new HttpError('Invoice payment review is required.', 503);
        let paid = 0;
        let returned = 0;
        let disputed = false;
        for (const payment of payments.data) {
          paid += payment.amount_paid || 0;
          const paymentIntentId = idOf(payment.payment.payment_intent);
          if (!paymentIntentId) continue;
          const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
          const charge = intent.latest_charge;
          if (charge && typeof charge !== 'string') { returned += charge.amount_refunded; disputed ||= charge.disputed; }
        }
        if (disputed || (paid > 0 && returned >= paid)) status = 'refunded';
        else if (paid < invoice.amount_paid) status = 'payment_pending';
      }
    }
    snapshots.push({ stripeMode: subscription.livemode ? 'live' : 'test', id: subscription.id, status, paidThrough: end ? new Date(end * 1000).toISOString() : null, cancelAtPeriodEnd: subscription.cancel_at_period_end, latestInvoiceId: invoice?.id || null, reconciledAt: new Date().toISOString(), created: subscription.created });
  }
  // A valid replacement subscription survives a later event from an older canceled subscription.
  snapshots.sort((a, b) => Number(['active', 'trialing'].includes(b.status) && Date.parse(b.paidThrough || '') > Date.now()) - Number(['active', 'trialing'].includes(a.status) && Date.parse(a.paidThrough || '') > Date.now()) || b.created - a.created);
  const selected = snapshots[0];
  if (!selected) return empty;
  const { created: _created, ...snapshot } = selected;
  return snapshot;
}

export async function reconcileMemberSubscription(memberId: string, stripe: Stripe = stripeClient()) {
  return withMemberLease(memberId, async token => {
    const data = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
    const subscription = await canonicalSubscription(data.members[memberId], data.settings.approvedPriceIds, stripe);
    return updateDocument(COMMERCE_DOCUMENT, initialCommerce, current => { checkLease(current, memberId, token); current.members[memberId].subscription = subscription; return current.members[memberId]; });
  });
}

export async function createMemberCheckout(memberId: string, stripe: Stripe = stripeClient()) {
  if (!(await getCommerceReadiness()).salesOpen) throw new HttpError('Subscriptions are not on sale yet. Please check back after launch.', 503);
  return withMemberLease(memberId, async token => {
    let data = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
    const member = data.members[memberId];
    if (!member.verifiedAt) throw new HttpError('Verify your email before subscribing.', 403);
    const priceId = data.settings.priceId!;
    await validatePrice(priceId, stripe);
    if (!member.stripeCustomerId) {
      const customer = await stripe.customers.create({ email: member.email, metadata: { memberId: member.id, publication: 'thursday-post' } }, { idempotencyKey: `thursday-member/${member.id}` });
      await updateDocument(COMMERCE_DOCUMENT, initialCommerce, current => { checkLease(current, memberId, token); current.members[memberId].stripeCustomerId = customer.id; });
      member.stripeCustomerId = customer.id;
    }
    const subscription = await canonicalSubscription(member, data.settings.approvedPriceIds, stripe);
    await updateDocument(COMMERCE_DOCUMENT, initialCommerce, current => { checkLease(current, memberId, token); current.members[memberId].subscription = subscription; });
    if (!['none', 'canceled', 'incomplete_expired'].includes(subscription.status)) throw new HttpError('You already have a subscription to manage. Open billing to review it.', 409);
    const existing = data.checkoutSessions?.[memberId];
    if (existing?.id && existing.expires > Date.now()) {
      const checkout = await stripe.checkout.sessions.retrieve(existing.id);
      if (idOf(checkout.customer) !== member.stripeCustomerId || checkout.client_reference_id !== memberId) throw new HttpError('The checkout account could not be verified.', 409);
      if (checkout.status === 'open' && checkout.url && existing.priceId === priceId) return { url: checkout.url };
      if (checkout.status === 'complete') throw new HttpError('Your payment is processing. Refresh your account shortly.', 409);
      if (checkout.status === 'open') await stripe.checkout.sessions.expire(existing.id);
    }
    data = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
    if (!data.settings.liveSalesEnabled || data.settings.priceId !== priceId) throw new HttpError('Subscription sales have changed. Refresh before continuing.', 409);
    // Persist identical retry parameters before the external request. A network timeout must not create a second checkout.
    const attempt = existing && !existing.id && existing.priceId === priceId && existing.expires > Date.now() ? existing : { id: null, priceId, expires: (Math.floor(Date.now() / 1000) + 1860) * 1000, requestId: randomUUID() };
    await updateDocument(COMMERCE_DOCUMENT, initialCommerce, current => { checkLease(current, memberId, token); current.checkoutSessions ||= {}; current.checkoutSessions[memberId] = attempt; });
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: member.stripeCustomerId, client_reference_id: member.id, line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ['card'], allow_promotion_codes: false, subscription_data: { metadata: { memberId: member.id, publication: 'thursday-post' } }, metadata: { memberId: member.id },
      success_url: `${publicOrigin()}/member?checkout=success`, cancel_url: `${publicOrigin()}/member?checkout=canceled`, expires_at: Math.floor(attempt.expires / 1000),
    }, { idempotencyKey: `thursday-checkout/${member.id}/${attempt.requestId}` });
    if (!checkout.url) throw new HttpError('Checkout is temporarily unavailable.', 503);
    const stillOpen = await updateDocument(COMMERCE_DOCUMENT, initialCommerce, current => { checkLease(current, memberId, token); current.checkoutSessions[memberId] = { ...attempt, id: checkout.id, expires: checkout.expires_at * 1000 }; return current.settings.liveSalesEnabled && current.settings.priceId === priceId; });
    if (!stillOpen) { await stripe.checkout.sessions.expire(checkout.id); throw new HttpError('Subscription sales changed while checkout was opening. Please refresh.', 409); }
    return { url: checkout.url };
  });
}

export async function createMemberPortal(memberId: string, stripe: Stripe = stripeClient()) {
  const member = (await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[memberId];
  if (!member?.verifiedAt || !member.stripeCustomerId) throw new HttpError('No billing account is linked to this member.', 404);
  const portal = await stripe.billingPortal.sessions.create({ customer: member.stripeCustomerId, return_url: `${publicOrigin()}/member` });
  return { url: portal.url };
}

export async function receiveStripeWebhook(request: Request, stripe: Stripe = stripeClient()) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret?.startsWith('whsec_')) throw new HttpError('Stripe webhook setup is incomplete.', 503);
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await readBoundedBody(request, 512_000), request.headers.get('stripe-signature') || '', secret); }
  catch { throw new HttpError('Invalid Stripe webhook signature.', 400); }
  if (event.livemode !== /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '')) throw new HttpError('Stripe event mode does not match this endpoint.', 400);
  if (!(STRIPE_EVENTS as readonly string[]).includes(event.type)) return { received: true, ignored: true };
  if ((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).stripeEvents[event.id]) return { received: true, duplicate: true };
  const object = event.data.object as unknown as { id: string; customer?: string | { id: string }; charge?: string | { id: string } };
  let customerId = idOf(object.customer);
  if (!customerId && object.charge) customerId = idOf((await stripe.charges.retrieve(idOf(object.charge)!)).customer);
  const data = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  const member = Object.values(data.members).find(candidate => candidate.stripeCustomerId === customerId);
  if (!member) return { received: true, ignored: true };
  return withMemberLease(member.id, async token => {
    const latest = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
    if (latest.stripeEvents[event.id]) return { received: true, duplicate: true };
    const subscription = await canonicalSubscription(latest.members[member.id], latest.settings.approvedPriceIds, stripe);
    await updateDocument(COMMERCE_DOCUMENT, initialCommerce, current => {
      checkLease(current, member.id, token);
      current.members[member.id].subscription = subscription;
      current.stripeEvents[event.id] = new Date().toISOString();
      const oldest = Date.now() - 90 * 24 * 60 * 60 * 1000;
      for (const [id, processedAt] of Object.entries(current.stripeEvents)) if (Date.parse(processedAt) < oldest) delete current.stripeEvents[id];
    });
    return { received: true, duplicate: false };
  });
}
