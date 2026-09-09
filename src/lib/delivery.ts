import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Webhook } from 'svix';
import { HttpError } from './auth';
import { readBoundedBody } from './email';
import { readDocument, updateDocument } from './durable-store';
import { getDeliveryRecipients, suppressMember, unsubscribeToken, unsubscribeMember } from './members';
import { currentEditionArticles, editionReviewHash, getEdition } from './editions';
import type { DeliveryJob, DeliveryStore, NewspaperEdition } from './edition-types';

export const DELIVERY_DOCUMENT = 'newspaper-delivery';
export const initialDelivery = (): DeliveryStore => ({ version: 1, jobs: [], campaigns: [], suppressions: {}, webhookIds: [] });
const normalize = (email: string) => email.trim().toLowerCase();
const deliveryId = (editionId: string, memberId: string) => createHash('sha256').update(`edition:${editionId}:member:${memberId}`).digest('hex');
const MAX_ATTEMPTS = 5;
const LEASE_MS = 90_000;
// Resend retains idempotency keys for 24 hours. Never retry an uncertain send after that window.
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

function configuration() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? '';
  const match = from.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  const domain = match?.[1].split('@')[1].toLowerCase();
  const configuredUrl = process.env.NEWSROOM_PUBLIC_URL;
  let site: URL | undefined;
  try { site = new URL(configuredUrl ?? ''); } catch { /* Report a safe configuration error below. */ }
  if (!apiKey || !domain || /[\r\n]/.test(from) || ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com'].includes(domain) || !site || site.protocol !== 'https:' || site.username || site.password) throw new HttpError('Newsletter delivery requires RESEND_API_KEY, a verified-domain RESEND_FROM_EMAIL and an HTTPS NEWSROOM_PUBLIC_URL.', 503);
  return { apiKey, from, site: site.origin };
}

export function deliveryReadiness() {
  try { configuration(); unsubscribeToken('readiness-check'); return { configured: true }; }
  catch { return { configured: false }; }
}

function payload(edition: NewspaperEdition, memberId: string, email: string): DeliveryJob['payload'] {
  const config = configuration();
  const link = `${config.site}/editions/${encodeURIComponent(edition.id)}`;
  const unsubscribe = `${config.site}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken(memberId))}`;
  const subject = `The Thursday Post · No. ${edition.number} · ${edition.date}`;
  const articleText = edition.articles.map(article => `${article.headline}\nBy ${article.byline.replace(/^By\s+/i, '')}\n\n${article.paragraphs.join('\n\n')}${article.limitations.length ? `\n\nReporting notes: ${article.limitations.join(' ')}` : ''}\n\nSources:\n${article.sources.map(source => `${source.title}: ${source.url}`).join('\n')}`).join('\n\n———\n\n');
  const text = `THE THURSDAY POST\n${edition.title}\nNo. ${edition.number} | ${edition.date}\n\n${edition.preview}\n\n${articleText}\n\nRead this edition online: ${link}\n\nTips, questions and corrections: workbenchadmin@gmail.com\nUnsubscribe from the newspaper: ${unsubscribe}\nUnsubscribing stops edition emails; it does not cancel your paid membership.`;
  const html = `<html><body style="margin:0;background:#f5f0e5;color:#25231f;font-family:Georgia,serif"><main style="max-width:680px;margin:auto;padding:32px 24px"><h1 style="border-bottom:3px double #25231f;padding-bottom:16px">The Thursday Post</h1><p>No. ${edition.number} · ${escapeHtml(edition.date)}</p><h2>${escapeHtml(edition.title)}</h2><p>${escapeHtml(edition.preview)}</p>${edition.articles.map(article => `<article style="border-top:1px solid #bbb3a6;padding-top:20px;margin-top:28px"><h2>${escapeHtml(article.headline)}</h2><p><em>By ${escapeHtml(article.byline.replace(/^By\s+/i, ''))}</em></p>${article.paragraphs.map(paragraph => `<p style="line-height:1.65">${escapeHtml(paragraph)}</p>`).join('')}${article.limitations.length ? `<p><strong>Reporting notes:</strong> ${escapeHtml(article.limitations.join(' '))}</p>` : ''}<p><strong>Sources</strong></p>${article.sources.map(source => `<p><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></p>`).join('')}</article>`).join('')}<hr><p><a href="${escapeHtml(link)}">Read the edition online</a></p><p>Tips, questions and corrections: <a href="mailto:workbenchadmin@gmail.com">workbenchadmin@gmail.com</a></p><p><a href="${escapeHtml(unsubscribe)}">Unsubscribe from edition emails</a>. This does not cancel your paid membership.</p></main></body></html>`;
  return { from: config.from, to: [email], subject, html, text, reply_to: 'workbenchadmin@gmail.com', headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, tags: [{ name: 'delivery_job', value: deliveryId(edition.id, memberId) }] };
}

/** Explicit owner SEND queues a fixed recipient snapshot. Repeated SEND never adds or resends jobs. */
export async function queueEditionDelivery(editionId: string, expectedReviewHash: string) {
  configuration();
  const edition = await getEdition(editionId);
  if (edition.status !== 'released' || edition.releasedBy !== 'James') throw new HttpError('Release the reviewed edition before sending.', 409);
  if (!expectedReviewHash || edition.reviewHash !== expectedReviewHash || editionReviewHash(edition) !== expectedReviewHash) throw new HttpError('Review the released edition again before sending.', 409);
  if ((await currentEditionArticles(edition)).length !== edition.articles.length) throw new HttpError('This edition contains a withdrawn article and cannot be sent.', 409);
  const recipients = [...new Map((await getDeliveryRecipients()).map(member => [normalize(member.email), member])).values()];
  const now = Date.now();
  // Sign and construct all immutable retry payloads outside the database transaction.
  const candidates: DeliveryJob[] = recipients.map(member => ({ id: deliveryId(edition.id, member.id), editionId: edition.id, editionHash: edition.reviewHash, memberId: member.id, email: normalize(member.email), status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: now, payload: payload(edition, member.id, normalize(member.email)) }));
  return updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => {
    const existing = data.campaigns.find(campaign => campaign.editionId === editionId);
    if (existing) return { queued: existing.recipients, alreadyQueued: true };
    const jobs = candidates.filter(job => !data.suppressions[job.email]);
    if (!jobs.length) throw new HttpError('There are no eligible, confirmed paying subscribers to send to.', 409);
    data.jobs.push(...jobs);
    data.campaigns.push({ editionId, editionHash: edition.reviewHash, queuedAt: now, queuedBy: 'James', recipients: jobs.length });
    return { queued: jobs.length, alreadyQueued: false };
  });
}

export async function getDeliveryStatus(editionId?: string) {
  const data = await readDocument(DELIVERY_DOCUMENT, initialDelivery);
  const jobs = data.jobs.filter(job => !editionId || job.editionId === editionId);
  return { configured: deliveryReadiness().configured, campaigns: data.campaigns.filter(campaign => !editionId || campaign.editionId === editionId), counts: Object.fromEntries(['pending', 'sending', 'sent', 'delivered', 'suppressed', 'failed', 'cancelled'].map(status => [status, jobs.filter(job => job.status === status).length])), jobs: jobs.map(({ payload: _payload, lease: _lease, ...job }) => job) };
}

async function claimJob(now: number, editionId?: string) {
  return updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => {
    for (const job of data.jobs) {
      if (editionId && job.editionId !== editionId) continue;
      if (job.status !== 'pending' && !(job.status === 'sending' && (!job.lease || job.lease.until <= now))) continue;
      if (data.suppressions[job.email]) { job.status = 'suppressed'; delete job.lease; continue; }
      if (job.attempts >= MAX_ATTEMPTS || (job.firstAttemptAt !== undefined && now - job.firstAttemptAt >= RETRY_WINDOW_MS)) { job.status = 'failed'; job.lastError = 'Retry limit reached. Check provider delivery records before any manual resend.'; delete job.lease; continue; }
      if (job.nextAttemptAt > now) continue;
      job.status = 'sending'; job.attempts++; job.firstAttemptAt ??= now; job.lease = { id: randomUUID(), until: now + LEASE_MS };
      return structuredClone(job);
    }
    return null;
  });
}

async function finishJob(job: DeliveryJob, result: { status: DeliveryJob['status']; error?: string; providerId?: string }) {
  await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => {
    const current = data.jobs.find(item => item.id === job.id);
    if (!current || current.lease?.id !== job.lease?.id) return;
    delete current.lease;
    if (data.suppressions[current.email]) { current.status = 'suppressed'; return; }
    current.status = current.status === 'delivered' ? 'delivered' : result.status;
    if (result.providerId) { current.providerId = result.providerId; current.sentAt = Date.now(); }
    if (result.error) current.lastError = result.error; else delete current.lastError;
    if (result.status === 'pending') current.nextAttemptAt = Date.now() + Math.min(60 * 60 * 1000, 30_000 * 2 ** (current.attempts - 1));
  });
}

/** Called only by an authenticated owner action or the authenticated scheduler. */
export async function processDeliveryQueue(options: { limit?: number; editionId?: string } = {}) {
  if (!deliveryReadiness().configured) return { processed: 0, sent: 0, configured: false };
  const config = configuration();
  let processed = 0; let sent = 0;
  const limit = Math.min(10, Math.max(1, Math.trunc(options.limit ?? 5)));
  for (let index = 0; index < limit; index++) {
    const job = await claimJob(Date.now(), options.editionId);
    if (!job) break;
    processed++;
    try {
      const member = (await getDeliveryRecipients()).find(item => item.id === job.memberId && normalize(item.email) === job.email);
      const suppressed = (await readDocument(DELIVERY_DOCUMENT, initialDelivery)).suppressions[job.email];
      if (!member || suppressed) { await finishJob(job, { status: 'suppressed' }); continue; }
      const edition = await getEdition(job.editionId);
      if (edition.status !== 'released' || edition.reviewHash !== job.editionHash || editionReviewHash(edition) !== job.editionHash || (await currentEditionArticles(edition)).length !== edition.articles.length) { await finishJob(job, { status: 'cancelled', error: 'Edition is no longer eligible for delivery.' }); continue; }
      if (!job.payload) { await finishJob(job, { status: 'failed', error: 'Immutable send payload is missing.' }); continue; }
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `thursday-post-${job.id}` }, body: JSON.stringify(job.payload), signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store' });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        await finishJob(job, { status: retryable && job.attempts < MAX_ATTEMPTS ? 'pending' : 'failed', error: `Delivery provider returned HTTP ${response.status}.` });
        if (response.status === 429) break;
        continue;
      }
      const result = z.object({ id: z.string().min(1).max(200) }).parse(JSON.parse(await readBoundedBody(response, 16_000)));
      await finishJob(job, { status: 'sent', providerId: result.id }); sent++;
    } catch {
      await finishJob(job, { status: job.attempts < MAX_ATTEMPTS ? 'pending' : 'failed', error: 'Delivery could not be confirmed. A bounded retry uses the same idempotency key.' });
    }
  }
  return { processed, sent, configured: true };
}

const webhookSchema = z.object({ type: z.string(), data: z.object({ email_id: z.string().min(1).max(200), to: z.array(z.string().max(320)).max(100).optional(), tags: z.record(z.string(), z.string()).optional() }) });

export async function receiveDeliveryWebhook(request: Request) {
  const secret = process.env.RESEND_DELIVERY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError('Delivery webhooks require RESEND_DELIVERY_WEBHOOK_SECRET.', 503);
  const body = await readBoundedBody(request, 128_000);
  const eventId = request.headers.get('svix-id') ?? '';
  const verified = new Webhook(secret).verify(body, { 'svix-id': eventId, 'svix-timestamp': request.headers.get('svix-timestamp') ?? '', 'svix-signature': request.headers.get('svix-signature') ?? '' });
  const event = webhookSchema.parse(verified);
  if (!['email.delivered', 'email.bounced', 'email.complained', 'email.suppressed', 'email.failed'].includes(event.type)) return { ignored: true };
  const suppress = ['email.bounced', 'email.complained', 'email.suppressed'].includes(event.type);
  const emails = await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => {
    const matched = data.jobs.filter(job => job.providerId === event.data.email_id || (!job.providerId && job.status === 'sending' && event.data.tags?.delivery_job === job.id && event.data.to?.some(email => normalize(email) === job.email)));
    const addresses = [...new Set(matched.map(job => job.email))];
    if (data.webhookIds.includes(eventId)) return suppress ? addresses : [];
    for (const job of matched) {
      job.providerId ??= event.data.email_id;
      if (suppress) {
        data.suppressions[job.email] = { reason: event.type, at: Date.now() };
        for (const recipientJob of data.jobs.filter(item => item.email === job.email && !['delivered', 'sent'].includes(item.status))) { recipientJob.status = 'suppressed'; delete recipientJob.lease; }
        job.status = 'suppressed'; delete job.lease;
      } else if (event.type === 'email.delivered' && job.status !== 'suppressed') job.status = 'delivered';
      else if (event.type === 'email.failed' && !['delivered', 'suppressed'].includes(job.status)) { job.status = 'failed'; job.lastError = 'Delivery provider reported failure.'; delete job.lease; }
    }
    // Unknown IDs remain replayable: a provider webhook can arrive before send confirmation commits.
    if (matched.length) data.webhookIds.push(eventId);
    return suppress ? addresses : [];
  });
  // Own suppression is already durable even if member persistence temporarily fails.
  for (const email of emails) await suppressMember(email, event.type);
  return { received: true };
}

export async function unsubscribeDelivery(token: string) {
  const member = await unsubscribeMember(token);
  const email = normalize(member.email);
  await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => {
    for (const job of data.jobs.filter(job => job.email === email && ['pending', 'sending'].includes(job.status))) { job.status = 'suppressed'; delete job.lease; }
  });
  return { unsubscribed: true };
}
