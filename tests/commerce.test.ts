import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import { closeDocuments, readDocument, updateDocument } from '../src/lib/durable-store';
import { COMMERCE_DOCUMENT, initialCommerce, type Member } from '../src/lib/commerce-types';
import { consumeMagicLink, currentMember, getDeliveryRecipients, hasPaidAccess, memberCookie, publicMember, requestMagicLink, requireMember, signOutMember, suppressMember, unsubscribeMember, unsubscribeToken, updateMemberPreferences } from '../src/lib/members';
import { createMemberCheckout, createMemberPortal, getCommerceReadiness, receiveStripeWebhook, reconcileMemberSubscription, updateCommerceSettings } from '../src/lib/commerce';
import { GET as memberGET, PATCH as memberPATCH } from '../src/app/api/member/route';
import { POST as checkoutPOST } from '../src/app/api/checkout/route';

const folder = mkdtempSync(join(tmpdir(), 'thursday-commerce-test-'));
process.env.NEWSROOM_DOCUMENT_DB_FILE = join(folder, 'documents.sqlite');
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.MEMBER_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.NEWSROOM_PUBLIC_URL = 'https://paper.example';
process.env.RESEND_FROM_EMAIL = 'The Thursday Post <members@paper.example>';
process.env.RESEND_API_KEY = 're_test_only';
process.env.STRIPE_SECRET_KEY = 'sk_test_local_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_test';
const realStripe = new Stripe('sk_test_local_fake');
beforeEach(async () => { await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { Object.assign(data, initialCommerce()); }); });
after(async () => { await closeDocuments(); rmSync(folder, { recursive: true, force: true }); });

function request(path = '/api/member', cookie?: string, body?: unknown) {
  return new Request(`https://paper.example${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://paper.example', ...(cookie ? { cookie } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function member(email = 'reader@example.org', consent = true) {
  let token = '';
  const result = await requestMagicLink(request(), { email, deliveryConsent: consent }, async message => { token = new URLSearchParams(new URL(message.url).hash.slice(1)).get('token')!; });
  assert.equal('token' in result, false);
  const session = await consumeMagicLink(token);
  const cookie = memberCookie(session, request()).split(';')[0];
  const account = (await currentMember(request('/api/member', cookie)))!;
  assert.ok(account);
  return { account, cookie, token, session };
}
const goodPrice = { id: 'price_monthly', active: true, type: 'recurring', currency: 'aud', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit', unit_amount: 2500, livemode: false, product: { id: 'prod_paper', active: true }, custom_unit_amount: null, transform_quantity: null };
function subscription(account: Member, status = 'active', overrides: Record<string, unknown> = {}) {
  return { id: 'sub_current', livemode: false, customer: account.stripeCustomerId, metadata: { memberId: account.id }, status, created: 1000, cancel_at_period_end: false, trial_end: Math.floor(Date.now() / 1000) + 86400, items: { data: [{ price: { id: 'price_monthly' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] }, latest_invoice: { id: 'in_latest', status: 'paid', amount_paid: 2500 }, ...overrides };
}
function mockStripe(options: { subscriptions?: unknown[]; refund?: number; price?: Record<string, unknown>; calls?: string[]; checkoutCalls?: Array<{ params: unknown; options: unknown }>; checkoutFailure?: boolean } = {}) {
  const calls = options.calls || [];
  const sdk = {
    webhooks: realStripe.webhooks,
    prices: { retrieve: async () => { calls.push('price'); return options.price || goodPrice; } },
    subscriptions: { list: async () => { calls.push('subscriptions'); return { data: options.subscriptions || [], has_more: false }; } },
    invoicePayments: { list: async () => ({ data: [{ amount_paid: 2500, payment: { payment_intent: 'pi_latest' } }], has_more: false }) },
    paymentIntents: { retrieve: async () => ({ latest_charge: { amount_refunded: options.refund || 0, disputed: false } }) },
    customers: { create: async () => ({ id: 'cus_new' }) },
    checkout: { sessions: {
      create: async (params: { expires_at: number }, optionsInput: unknown) => { options.checkoutCalls?.push({ params, options: optionsInput }); if (options.checkoutFailure) throw new Error('simulated network timeout'); return { id: 'cs_saved', url: 'https://checkout.stripe.com/pay/cs_saved', expires_at: params.expires_at }; },
      retrieve: async () => ({ status: 'open', id: 'cs_saved', url: 'https://checkout.stripe.com/pay/cs_saved' }),
      expire: async () => ({ status: 'expired' }),
    } },
    billingPortal: { sessions: { create: async (params: { customer: string }) => { calls.push(`portal:${params.customer}`); return { url: 'https://billing.stripe.com/session/example' }; } } },
  };
  return sdk as unknown as Stripe;
}
async function linkCustomer(account: Member, id = 'cus_reader') {
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.members[account.id].stripeCustomerId = id; data.settings.approvedPriceIds = ['price_monthly']; });
  account.stripeCustomerId = id;
}
function signedEvent(customer: string, id = `evt_${randomUUID()}`, type = 'customer.subscription.updated', status = 'active') {
  const payload = JSON.stringify({ id, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { id: 'sub_current', object: 'subscription', customer, status } } });
  return new Request('https://paper.example/api/webhooks/stripe', { method: 'POST', body: payload, headers: { 'stripe-signature': realStripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! }) } });
}

test('magic links are hashed, single-use and expiring; public API never returns the token', async () => {
  let raw = '';
  const response = await requestMagicLink(request(), { email: ' Reader@Example.org ', deliveryConsent: true }, async mail => { raw = new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token')!; assert.equal(new URL(mail.url).search, ''); });
  const stored = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  assert.ok(stored.links[createHash('sha256').update(raw).digest('hex')]);
  assert.equal(JSON.stringify(stored).includes(raw), false);
  assert.equal(JSON.stringify(response).includes(raw), false);
  const results = await Promise.allSettled([consumeMagicLink(raw), consumeMagicLink(raw)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(consumeMagicLink(raw), /invalid or expired/);
  assert.equal(Object.values((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members)[0].email, 'reader@example.org');
  let expired = '';
  await requestMagicLink(request(), { email: 'expired@example.org' }, async mail => { expired = new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token')!; });
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.links[createHash('sha256').update(expired).digest('hex')].expires = Date.now() - 1; });
  await assert.rejects(consumeMagicLink(expired), /invalid or expired/);
});

test('member sign-in rate limits mail requests and removes unusable tokens after mail failure', async () => {
  for (let i = 0; i < 3; i++) await requestMagicLink(request(), { email: 'limited@example.org' }, async () => {});
  await assert.rejects(requestMagicLink(request(), { email: 'limited@example.org' }, async () => { throw new Error('must not send'); }), /Too many/);
  await assert.rejects(requestMagicLink(request(), { email: 'failed@example.org' }, async () => { throw new Error('mail failure'); }), /mail failure/);
  assert.equal(Object.values((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).links).some(link => link.email === 'failed@example.org'), false);
});

test('sign-in email sends replies to the editor and uses Thursday Post branding', async () => {
  const originalFetch = globalThis.fetch;
  const contact = process.env.NEWSROOM_CONTACT_EMAIL;
  process.env.NEWSROOM_CONTACT_EMAIL = 'editor@paper.example';
  let captured: { reply_to: string; subject: string; text: string } | undefined;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    captured = JSON.parse(String(options?.body));
    return Response.json({ id: 'test-mail-only' });
  };
  try {
    await requestMagicLink(request(), { email: 'branding@example.org' });
    assert.equal(captured?.reply_to, 'editor@paper.example');
    assert.equal(captured?.subject, 'Your secure link to Thursday Post');
    assert.match(captured!.text, /^Sign in to Thursday Post:/);
    assert.equal(captured!.text.includes('The Thursday Post'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (contact === undefined) delete process.env.NEWSROOM_CONTACT_EMAIL; else process.env.NEWSROOM_CONTACT_EMAIL = contact;
  }
});

test('member sessions reject tampering, owner cookies and revoked sessions; cookies are secure', async () => {
  const { account, cookie, session } = await member();
  assert.ok(memberCookie(session, request()).includes('HttpOnly; SameSite=Lax; Path=/;'));
  assert.ok(memberCookie(session, request()).endsWith('; Secure'));
  assert.equal((await requireMember(request('/api/member', cookie))).id, account.id);
  assert.equal(await currentMember(request('/api/member', cookie + 'forged')), null);
  assert.equal(await currentMember(request('/api/member', `newsroom_session=${session}`)), null);
  await signOutMember(request('/api/member', cookie));
  await assert.rejects(requireMember(request('/api/member', cookie)), /Sign in/);
});

test('verified consent controls delivery; anonymous sign-in cannot overwrite existing preferences', async () => {
  const { account } = await member('reader@example.org', false);
  assert.equal(account.deliveryEnabled, false);
  await requestMagicLink(request(), { email: account.email, deliveryConsent: true }, async () => {});
  assert.equal((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[account.id].deliveryEnabled, false);
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.members[account.id].subscription = { ...account.subscription, stripeMode: 'test', status: 'active', paidThrough: new Date(Date.now() + 86400000).toISOString() }; });
  assert.deepEqual(await getDeliveryRecipients(), []);
  await updateMemberPreferences(account.id, true);
  assert.deepEqual(await getDeliveryRecipients(), [{ id: account.id, email: account.email }]);
  const billingBefore = (await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[account.id].subscription;
  await suppressMember(account.email, 'email.bounced');
  assert.deepEqual(await getDeliveryRecipients(), []);
  assert.deepEqual((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[account.id].subscription, billingBefore);
  await assert.rejects(updateMemberPreferences(account.id, true), /delivery problem/);
});

test('unsubscribe capability cannot sign in and never changes paid access', async () => {
  const { account } = await member();
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.members[account.id].subscription = { ...account.subscription, stripeMode: 'test', status: 'active', paidThrough: new Date(Date.now() + 86400000).toISOString() }; });
  const token = unsubscribeToken(account.id);
  assert.equal(await currentMember(request('/api/member', `thursday_member=${token}`)), null);
  const result = await unsubscribeMember(token);
  assert.equal(result.email, account.email); assert.equal(result.deliveryEnabled, false); assert.equal(result.paidAccess, true);
  await assert.rejects(unsubscribeMember(token + 'bad'), /invalid/);
});

test('member endpoints ignore account query spoofing and reject arbitrary preference fields', async () => {
  const first = await member('first@example.org');
  const second = await member('second@example.org');
  const response = await memberGET(request(`/api/member?memberId=${second.account.id}`, first.cookie));
  const result = await response.json();
  assert.equal(result.member.email, first.account.email);
  assert.equal(JSON.stringify(result.member).includes('stripeCustomerId'), false);
  const patch = await memberPATCH(request('/api/member', first.cookie, { deliveryEnabled: false, memberId: second.account.id }));
  assert.equal(patch.status, 400);
  const anonymous = await checkoutPOST(request('/api/checkout', undefined, { priceId: 'price_attacker' }));
  assert.equal(anonymous.status, 401);
});

test('sales default closed; owner must validate a fixed monthly AUD price before opening', async () => {
  assert.equal((await getCommerceReadiness()).salesOpen, false);
  await assert.rejects(updateCommerceSettings({ liveSalesEnabled: true }, mockStripe()), /price/);
  await assert.rejects(updateCommerceSettings({ priceId: 'price_monthly' }, mockStripe({ price: { ...goodPrice, currency: 'usd' } })), /monthly AUD/);
  await updateCommerceSettings({ priceId: 'price_monthly' }, mockStripe());
  assert.equal((await getCommerceReadiness()).salesOpen, false);
  await updateCommerceSettings({ liveSalesEnabled: true }, mockStripe());
  assert.equal((await getCommerceReadiness()).salesOpen, true);
  await updateCommerceSettings({ liveSalesEnabled: false });
  assert.equal((await getCommerceReadiness()).salesOpen, false);
});

test('checkout locks the price and account server-side and persists identical parameters on timeout retry', async () => {
  const { account } = await member();
  await assert.rejects(createMemberCheckout(account.id, mockStripe()), /not on sale/);
  await updateCommerceSettings({ priceId: 'price_monthly', liveSalesEnabled: true }, mockStripe());
  const calls: Array<{ params: unknown; options: unknown }> = [];
  await assert.rejects(createMemberCheckout(account.id, mockStripe({ checkoutCalls: calls, checkoutFailure: true })), /network timeout/);
  const result = await createMemberCheckout(account.id, mockStripe({ checkoutCalls: calls }));
  assert.equal(result.url, 'https://checkout.stripe.com/pay/cs_saved');
  assert.deepEqual(calls[0], calls[1], 'network retry must reuse exact parameters and idempotency key');
  const params = calls[1].params as { customer: string; client_reference_id: string; line_items: unknown[] };
  assert.equal(params.customer, 'cus_new'); assert.equal(params.client_reference_id, account.id);
  assert.deepEqual(params.line_items, [{ price: 'price_monthly', quantity: 1 }]);
});

test('billing portal always uses the authenticated member stored customer', async () => {
  const first = await member('first@example.org'); const second = await member('second@example.org');
  await linkCustomer(first.account, 'cus_first'); await linkCustomer(second.account, 'cus_second');
  const calls: string[] = [];
  const signedIn = await requireMember(request('/api/billing/portal?customerId=cus_second', first.cookie, { customerId: 'cus_second' }));
  await createMemberPortal(signedIn.id, mockStripe({ calls }));
  assert.deepEqual(calls, ['portal:cus_first']);
});

test('an open checkout is reused; closing sales expires the outstanding hosted checkout', async () => {
  const { account } = await member();
  await updateCommerceSettings({ priceId: 'price_monthly', liveSalesEnabled: true }, mockStripe());
  const checkoutCalls: Array<{ params: unknown; options: unknown }> = [];
  const sdk = mockStripe({ checkoutCalls });
  let expired = 0;
  Object.assign(sdk.checkout.sessions, { retrieve: async () => ({ status: 'open', id: 'cs_saved', customer: 'cus_new', client_reference_id: account.id, url: 'https://checkout.stripe.com/pay/cs_saved' }), expire: async () => { expired++; return { status: 'expired' }; } });
  await createMemberCheckout(account.id, sdk);
  await createMemberCheckout(account.id, sdk);
  assert.equal(checkoutCalls.length, 1);
  await updateCommerceSettings({ liveSalesEnabled: false }, sdk);
  assert.equal(expired, 1);
  assert.equal((await getCommerceReadiness()).salesOpen, false);
});

test('Stripe verifies raw signatures, deduplicates replay and canonical canceled state defeats stale active events', async () => {
  const { account } = await member(); await linkCustomer(account);
  const calls: string[] = [];
  const sdk = mockStripe({ subscriptions: [subscription(account, 'canceled')], calls });
  await assert.rejects(receiveStripeWebhook(new Request('https://paper.example/api/webhooks/stripe', { method: 'POST', body: '{}' }), sdk), /signature/);
  assert.deepEqual(calls, []);
  await receiveStripeWebhook(signedEvent('cus_reader', 'evt_stale', 'customer.subscription.updated', 'active'), sdk);
  const stored = (await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[account.id];
  assert.equal(stored.subscription.status, 'canceled'); assert.equal(hasPaidAccess(stored), false);
  assert.equal((await receiveStripeWebhook(signedEvent('cus_reader', 'evt_stale'), sdk)).duplicate, true);
  assert.equal(calls.filter(call => call === 'subscriptions').length, 1);
});

test('concurrent webhooks retry after the lease; failed reconciliation is never marked processed', async () => {
  const { account } = await member(); await linkCustomer(account);
  const sdk = mockStripe();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  Object.assign(sdk.subscriptions, { list: async () => { entered(); await pending; return { data: [subscription(account, 'canceled')], has_more: false }; } });
  const first = receiveStripeWebhook(signedEvent('cus_reader', 'evt_first'), sdk);
  await started;
  await assert.rejects(receiveStripeWebhook(signedEvent('cus_reader', 'evt_second'), sdk), /updating/);
  assert.equal((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).stripeEvents.evt_second, undefined);
  release(); await first;
  await receiveStripeWebhook(signedEvent('cus_reader', 'evt_second'), sdk);
  Object.assign(sdk.subscriptions, { list: async () => { throw new Error('Stripe temporarily unavailable'); } });
  await assert.rejects(receiveStripeWebhook(signedEvent('cus_reader', 'evt_failed'), sdk), /temporarily unavailable/);
  assert.equal((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).stripeEvents.evt_failed, undefined);
  assert.equal(Object.keys((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).leases).length, 0);
});

test('canonical reconciliation retains scheduled cancellation until expiry and revokes failed or fully refunded payment', async () => {
  const { account } = await member(); await linkCustomer(account);
  let result = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account, 'active', { cancel_at_period_end: true })] }));
  assert.equal(hasPaidAccess(result), true); assert.equal(result.subscription.cancelAtPeriodEnd, true);
  result = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account, 'past_due')] }));
  assert.equal(hasPaidAccess(result), false);
  result = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account)], refund: 2500 }));
  assert.equal(result.subscription.status, 'refunded'); assert.equal(hasPaidAccess(result), false);
  result = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account)], refund: 500 }));
  assert.equal(hasPaidAccess(result), true, 'a partial refund does not cancel the remaining subscription');
  result.subscription.paidThrough = new Date(Date.now() - 1).toISOString();
  assert.equal(hasPaidAccess(result), false);
  assert.equal('stripeCustomerId' in publicMember(result), false);
});

test('foreign customer metadata or unapproved price never grants access; replacement active subscription survives old cancellation', async () => {
  const { account } = await member(); await linkCustomer(account);
  let result = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account, 'active', { metadata: { memberId: randomUUID() } })] }));
  assert.equal(hasPaidAccess(result), false);
  result = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account, 'active', { items: { data: [{ price: { id: 'price_foreign' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] } })] }));
  assert.equal(hasPaidAccess(result), false);
  result = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account, 'canceled', { id: 'sub_old', created: 2000 }), subscription(account, 'active', { id: 'sub_new', created: 1000 })] }));
  assert.equal(result.subscription.id, 'sub_new'); assert.equal(hasPaidAccess(result), true);
});

test('test/live entitlements are isolated and legacy live members regain access only through canonical refresh', async () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  try {
    const { account, cookie } = await member(); await linkCustomer(account);
    let saved = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account)] }));
    assert.equal(saved.subscription.stripeMode, 'test'); assert.equal(hasPaidAccess(saved), true);
    assert.equal((await getDeliveryRecipients()).length, 1);

    process.env.STRIPE_SECRET_KEY = 'sk_live_fixture_only_no_network';
    assert.equal(hasPaidAccess(saved), false, 'a test payment must never grant a live entitlement');
    assert.deepEqual(await getDeliveryRecipients(), [], 'test payments must not enter live edition delivery');
    assert.equal((await (await memberGET(request('/api/member', cookie))).json()).member.paidAccess, false);
    saved = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account)] }));
    assert.equal(hasPaidAccess(saved), false, 'even a canonical response from the wrong mode must fail closed');

    await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
      data.members[account.id].subscription = { id: 'sub_legacy_live', status: 'active', paidThrough: new Date(Date.now() + 86400000).toISOString(), cancelAtPeriodEnd: false, latestInvoiceId: 'in_legacy', reconciledAt: new Date().toISOString() };
    });
    assert.deepEqual(await getDeliveryRecipients(), [], 'an unstamped legacy record requires verification');
    const legacy = (await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[account.id];
    assert.equal(hasPaidAccess(legacy), false);
    saved = await reconcileMemberSubscription(account.id, mockStripe({ subscriptions: [subscription(account, 'active', { livemode: true, id: 'sub_legacy_live' })] }));
    assert.equal(saved.subscription.stripeMode, 'live'); assert.equal(hasPaidAccess(saved), true);
    assert.equal((await getDeliveryRecipients()).length, 1, 'real live subscribers recover after a mode-verified refresh');

    process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_only';
    assert.equal(hasPaidAccess(saved), false, 'live snapshots also cannot cross into a test environment');
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal(hasPaidAccess(saved), false, 'an unconfigured environment cannot grant paid access');
  } finally { if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = originalKey; }
});
