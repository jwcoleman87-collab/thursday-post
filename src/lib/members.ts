import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './auth';
import { getEmailConfiguration, readBoundedBody } from './email';
import { readDocument, updateDocument } from './durable-store';
import { COMMERCE_DOCUMENT, initialCommerce, type Member } from './commerce-types';

export type { Member } from './commerce-types';
export const MEMBER_COOKIE = 'thursday_member';
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const LINK_AGE = 15 * 60 * 1000;
export const MEMBER_CONSENT_TEXT = 'Email me The Thursday Post editions. I can unsubscribe at any time.';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function publicOrigin(): string {
  const raw = process.env.NEWSROOM_PUBLIC_URL || process.env.APP_URL || '';
  try {
    const url = new URL(raw);
    const loopback = !process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) throw new Error();
    return url.origin;
  } catch { throw new HttpError('Member access is awaiting the newspaper website address.', 503); }
}

function sessionSecret(): string {
  const secret = process.env.MEMBER_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new HttpError('Member sign-in is awaiting secure configuration.', 503);
  return secret;
}

export function memberSignInReady(): boolean {
  try { sessionSecret(); publicOrigin(); return Boolean(process.env.RESEND_API_KEY && getEmailConfiguration().senderConfigured); }
  catch { return false; }
}

export interface MagicLinkMessage { to: string; url: string; idempotencyKey: string }
export type MagicLinkTransport = (message: MagicLinkMessage) => Promise<void>;

async function sendMagicLink(message: MagicLinkMessage) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, reply_to: getEmailConfiguration().contactEmail, to: [message.to], subject: 'Your secure link to Thursday Post', text: `Sign in to Thursday Post:\n\n${message.url}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, you can ignore this email.` }),
    signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new HttpError('Your sign-in email could not be sent. Please try again later.', 503);
  const result = z.object({ id: z.string().min(1) }).safeParse(JSON.parse(await readBoundedBody(response, 16_000)));
  if (!result.success) throw new HttpError('Your sign-in email could not be confirmed. Please try again later.', 503);
}

export async function requestMagicLink(request: Request, input: { email: string; deliveryConsent?: boolean }, transport: MagicLinkTransport = sendMagicLink) {
  const email = z.email().max(254).parse(input.email.trim().toLowerCase());
  if (!memberSignInReady()) throw new HttpError('Member sign-in is being set up. Please check back soon.', 503);
  const now = Date.now();
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = digest(rawToken);
  // IP values are hashed before storage. Trust the first forwarded address only on Vercel.
  const address = process.env.VERCEL ? (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim() : 'local';
  const keys = [{ key: `email:${digest(email)}`, limit: 3 }, { key: `ip:${digest(address)}`, limit: 10 }, { key: 'global', limit: 100 }];
  const accepted = await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
    for (const [key, item] of Object.entries(data.attempts)) if (item.until <= now) delete data.attempts[key];
    for (const [key, item] of Object.entries(data.links)) if (item.expires <= now) delete data.links[key];
    for (const [key, item] of Object.entries(data.sessions)) if (item.expires <= now) delete data.sessions[key];
    if (keys.some(({ key, limit }) => (data.attempts[key]?.count || 0) >= limit)) return false;
    for (const { key } of keys) { const item = data.attempts[key] ||= { count: 0, until: now + LINK_AGE }; item.count++; }
    // Do not alter an existing member's consent from an anonymous sign-in request.
    data.links[tokenHash] = { email, expires: now + LINK_AGE, deliveryConsent: input.deliveryConsent === true };
    return true;
  });
  if (!accepted) throw new HttpError('Too many sign-in requests. Please wait 15 minutes and try again.', 429);
  try { await transport({ to: email, url: `${publicOrigin()}/member/verify#token=${rawToken}`, idempotencyKey: `member-link/${tokenHash}` }); }
  catch (error) { await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { delete data.links[tokenHash]; }); throw error; }
  return { ok: true, message: 'Check your inbox for a secure sign-in link. It expires in 15 minutes.' };
}

export async function consumeMagicLink(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError('This sign-in link is invalid or expired. Request a new link.', 400);
  const secret = sessionSecret();
  const now = Date.now();
  const nonce = randomBytes(32).toString('base64url');
  const result = await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
    const link = data.links[digest(token)];
    if (!link || link.expires <= now) throw new HttpError('This sign-in link is invalid or expired. Request a new link.', 400);
    delete data.links[digest(token)];
    let member = Object.values(data.members).find(candidate => candidate.email === link.email);
    if (!member) {
      member = { id: randomUUID(), email: link.email, createdAt: new Date(now).toISOString(), verifiedAt: new Date(now).toISOString(), deliveryEnabled: link.deliveryConsent, consentAt: link.deliveryConsent ? new Date(now).toISOString() : null, consentVersion: 'edition-email-v1', suppressedAt: null, suppressionReason: null, stripeCustomerId: null, subscription: { id: null, status: 'none', paidThrough: null, cancelAtPeriodEnd: false, latestInvoiceId: null, reconciledAt: null } };
      data.members[member.id] = member;
    }
    data.sessions[digest(nonce)] = { memberId: member.id, expires: now + SESSION_AGE };
    return { memberId: member.id, nonce, issued: now, expires: now + SESSION_AGE };
  });
  const body = Buffer.from(JSON.stringify({ ...result, audience: 'thursday-member' })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function readSession(request: Request): { memberId: string; nonce: string; expires: number } | null {
  const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${MEMBER_COOKIE}=`))?.slice(MEMBER_COOKIE.length + 1);
  if (!value || value.length > 2000) return null;
  try {
    const [body, signature, ...rest] = value.split('.');
    if (rest.length || !body || !signature) return null;
    const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
    if (!timingSafeEqual(Buffer.from(digest(signature)), Buffer.from(digest(expected)))) return null;
    const parsed = z.object({ audience: z.literal('thursday-member'), memberId: z.string().uuid(), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), issued: z.number(), expires: z.number() }).parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    const now = Date.now();
    if (parsed.expires <= now || parsed.issued > now || parsed.expires - parsed.issued !== SESSION_AGE) return null;
    return parsed;
  } catch { return null; }
}

export async function currentMember(request: Request): Promise<Member | null> {
  const session = readSession(request);
  if (!session) return null;
  const data = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  const stored = data.sessions[digest(session.nonce)];
  if (!stored || stored.memberId !== session.memberId || stored.expires !== session.expires || stored.expires <= Date.now()) return null;
  return data.members[session.memberId] || null;
}

export async function requireMember(request: Request): Promise<Member> {
  const member = await currentMember(request);
  if (!member?.verifiedAt) throw new HttpError('Sign in to your Thursday Post account.', 401);
  return member;
}

export async function signOutMember(request: Request) {
  const session = readSession(request);
  if (session) await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { delete data.sessions[digest(session.nonce)]; });
}

export function memberCookie(token: string, request: Request) {
  const secure = Boolean(process.env.VERCEL) || new URL(request.url).protocol === 'https:';
  return `${MEMBER_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? SESSION_AGE / 1000 : 0}${secure ? '; Secure' : ''}`;
}

export function configuredStripeMode(): 'live' | 'test' | null {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return /^(sk|rk)_live_/.test(key) ? 'live' : /^(sk|rk)_test_/.test(key) ? 'test' : null;
}

export function hasPaidAccess(member: Member): boolean {
  const mode = configuredStripeMode();
  return Boolean(mode && member.subscription.stripeMode === mode && member.verifiedAt && ['active', 'trialing'].includes(member.subscription.status) && member.subscription.paidThrough && Date.parse(member.subscription.paidThrough) > Date.now());
}

export function publicMember(member: Member) {
  return { id: member.id, email: member.email, verifiedAt: member.verifiedAt, deliveryEnabled: member.deliveryEnabled, deliverySuppressed: Boolean(member.suppressedAt), subscription: { status: member.subscription.status, paidThrough: member.subscription.paidThrough, cancelAtPeriodEnd: member.subscription.cancelAtPeriodEnd }, paidAccess: hasPaidAccess(member), billingAvailable: Boolean(member.stripeCustomerId) };
}

export async function updateMemberPreferences(memberId: string, deliveryEnabled: boolean) {
  return updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
    const member = data.members[memberId];
    if (!member) throw new HttpError('Member account not found.', 404);
    if (deliveryEnabled && member.suppressedAt) throw new HttpError('Email delivery is paused after a delivery problem. Contact the editor to restore it.', 409);
    member.deliveryEnabled = deliveryEnabled;
    if (deliveryEnabled) member.consentAt = new Date().toISOString();
    return publicMember(member);
  });
}

export async function getDeliveryRecipients(): Promise<Array<{ id: string; email: string }>> {
  const data = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  return Object.values(data.members).filter(member => hasPaidAccess(member) && member.deliveryEnabled && member.consentAt && !member.suppressedAt).map(({ id, email }) => ({ id, email }));
}

export async function suppressMember(email: string, reason: string) {
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
    const member = Object.values(data.members).find(candidate => candidate.email === email.trim().toLowerCase());
    if (member) { member.suppressedAt = new Date().toISOString(); member.suppressionReason = reason.slice(0, 160); member.deliveryEnabled = false; }
  });
}

export function unsubscribeToken(memberId: string): string {
  const body = Buffer.from(JSON.stringify({ memberId, audience: 'edition-unsubscribe' })).toString('base64url');
  return `${body}.${createHmac('sha256', sessionSecret()).update(body).digest('base64url')}`;
}

export async function unsubscribeMember(token: string) {
  try {
    const [body, signature, ...rest] = token.split('.');
    if (rest.length || !body || !signature || token.length > 2000) throw new Error();
    const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
    if (!timingSafeEqual(Buffer.from(digest(signature)), Buffer.from(digest(expected)))) throw new Error();
    const parsed = z.object({ memberId: z.string().uuid(), audience: z.literal('edition-unsubscribe') }).parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    return await updateMemberPreferences(parsed.memberId, false);
  } catch { throw new HttpError('This unsubscribe link is invalid. Sign in to manage email preferences.', 400); }
}
