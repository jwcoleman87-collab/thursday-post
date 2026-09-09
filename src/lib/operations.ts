import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './auth';
import { readDocument, updateDocument } from './durable-store';
import { readStore } from './store';
import { getDeliveryRecipients } from './members';

const key = 'newsroom-operations';
const runId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const usageSchema = z.array(z.object({ model: z.string().regex(/^[a-z0-9_-]+\/[a-z0-9._:-]+$/i).max(150), stage: z.enum(['preflight', 'research', 'editorial']), inputTokens: z.number().int().nonnegative().max(100_000_000).nullable(), outputTokens: z.number().int().nonnegative().max(100_000_000).nullable() }).strict()).max(200);
export type RunUsage = z.infer<typeof usageSchema>;
export interface RunRecord {
  id: string; mode: 'demo' | 'live' | 'collect'; status: 'running' | 'completed' | 'failed' | 'interrupted'; startedAt: string; finishedAt?: string; durationMs?: number;
  errorCode?: string; error?: string; usage: RunUsage; inputTokens: number; outputTokens: number; estimatedUsd: number | null;
}
interface AlertRecord { id: string; runId: string; status: 'sending' | 'sent' | 'failed' | 'unknown'; createdAt: string; finishedAt?: string }
interface OperationsData {
  version: 1; runs: RunRecord[]; alerts: AlertRecord[];
  totals: { started: number; completed: number; failed: number; interrupted: number; inputTokens: number; outputTokens: number; estimatedKnownCostUsd: number; unpricedRuns: number };
}
const initial = (): OperationsData => ({ version: 1, runs: [], alerts: [], totals: { started: 0, completed: 0, failed: 0, interrupted: 0, inputTokens: 0, outputTokens: 0, estimatedKnownCostUsd: 0, unpricedRuns: 0 } });

/** Raw provider errors can contain source material or credentials. Persist a fixed public-safe vocabulary. */
function safeFailure(error: unknown): { errorCode: string; error: string } {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'customer_verification_required') return { errorCode: 'account_verification', error: 'Model access requires account verification.' };
  if (status === 401 || status === 403) return { errorCode: 'access_denied', error: 'A configured service rejected access.' };
  if (status === 402) return { errorCode: 'provider_budget', error: 'The model provider reported unavailable credits or budget.' };
  if (status === 429) return { errorCode: 'rate_limited', error: 'A configured service reported a rate limit.' };
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return { errorCode: 'timeout', error: 'A workflow operation exceeded its time limit.' };
  return { errorCode: 'workflow_failed', error: 'A research or workflow operation failed. Review the private newsroom audit.' };
}

/** Explicit per-model input/output USD rates only. Missing rates or usage produce null, never a fabricated price. */
export function estimateRunCost(usage: RunUsage, ratesJson = process.env.NEWSROOM_MODEL_PRICES_JSON): number | null {
  if (!usage.length || !usageSchema.safeParse(usage).success) return null;
  let prices: Record<string, { inputUsdPerMillion: number; outputUsdPerMillion: number }>;
  try { prices = z.record(z.string(), z.object({ inputUsdPerMillion: z.number().nonnegative().max(1_000_000), outputUsdPerMillion: z.number().nonnegative().max(1_000_000) }).strict()).parse(JSON.parse(ratesJson || '{}')); }
  catch { return null; }
  let estimate = 0;
  for (const item of usage) {
    const price = prices[item.model];
    if (!price || item.inputTokens === null || item.outputTokens === null) return null;
    estimate += (item.inputTokens * price.inputUsdPerMillion + item.outputTokens * price.outputUsdPerMillion) / 1_000_000;
  }
  return Math.round(estimate * 100_000_000) / 100_000_000;
}

export async function beginRunRecord(mode: 'demo' | 'live' | 'collect', id: string): Promise<RunRecord> {
  runId.parse(id);
  z.enum(['demo', 'live', 'collect']).parse(mode);
  return updateDocument(key, initial, data => {
    const existing = data.runs.find(run => run.id === id);
    if (existing) { if (existing.mode !== mode) throw new HttpError('Run identity is already used by another mode.', 409); return structuredClone(existing); }
    if (data.runs.filter(run => run.status === 'running').length >= 200) throw new HttpError('Resolve interrupted run records before starting more work.', 409);
    const record: RunRecord = { id, mode, status: 'running', startedAt: new Date().toISOString(), usage: [], inputTokens: 0, outputTokens: 0, estimatedUsd: null };
    data.runs.push(record); data.totals.started++;
    while (data.runs.length > 200) { const index = data.runs.findIndex(run => run.status !== 'running'); if (index < 0) break; data.runs.splice(index, 1); }
    return structuredClone(record);
  });
}

export async function finishRunRecord(id: string, input: { status: 'completed' | 'failed' | 'interrupted'; error?: unknown; usage?: RunUsage }): Promise<RunRecord> {
  runId.parse(id);
  z.enum(['completed', 'failed', 'interrupted']).parse(input.status);
  const usage = usageSchema.parse(input.usage ?? []);
  const estimatedUsd = estimateRunCost(usage);
  return updateDocument(key, initial, data => {
    const record = data.runs.find(run => run.id === id);
    if (!record) throw new HttpError('Run record not found.', 404);
    if (record.status !== 'running') return structuredClone(record);
    record.status = input.status; record.finishedAt = new Date().toISOString(); record.durationMs = Math.max(0, Date.parse(record.finishedAt) - Date.parse(record.startedAt));
    record.usage = usage; record.inputTokens = usage.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0); record.outputTokens = usage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0); record.estimatedUsd = estimatedUsd;
    if (input.status !== 'completed') Object.assign(record, safeFailure(input.error));
    data.totals[input.status]++; data.totals.inputTokens += record.inputTokens; data.totals.outputTokens += record.outputTokens;
    if (estimatedUsd === null) data.totals.unpricedRuns++; else data.totals.estimatedKnownCostUsd += estimatedUsd;
    return structuredClone(record);
  });
}

export async function operationsPayload(now = Date.now()) {
  const [data, store, deliveryRecipients] = await Promise.all([readDocument(key, initial), readStore(), getDeliveryRecipients()]);
  const recent = [...data.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const live = recent.find(run => run.mode === 'live');
  const collection = recent.find(run => run.mode === 'collect');
  const monitored = recent.find(run => run.mode === 'live' || run.mode === 'collect');
  const stale = recent.filter(run => run.status === 'running' && now - Date.parse(run.startedAt) > 10 * 60_000);
  const issues: { code: string; message: string; severity: 'warning' | 'error' }[] = [];
  if (live && ['failed', 'interrupted'].includes(live.status)) issues.push({ code: 'latest_live_failed', message: 'The latest live run did not complete successfully.', severity: 'error' });
  if (collection && ['failed', 'interrupted'].includes(collection.status)) issues.push({ code: 'latest_collection_failed', message: 'The latest source collection did not complete successfully.', severity: 'error' });
  if (stale.length) issues.push({ code: 'stale_run', message: `${stale.length} run record(s) need interruption review.`, severity: 'error' });
  if (store.monitoring && (!monitored || now - Date.parse(monitored.startedAt) > 26 * 60 * 60_000)) issues.push({ code: 'missed_daily_run', message: 'No live research or source collection was recorded within the expected daily monitoring window.', severity: 'warning' });
  if (store.monitoring && process.env.NEWSROOM_AI_PAUSED === 'true') issues.push({ code: 'monitoring_ai_paused', message: 'Monitoring is enabled while live AI is paused.', severity: 'warning' });
  return { status: issues.length ? 'attention' as const : store.monitoring ? 'healthy' as const : 'paused' as const, monitoring: store.monitoring, aiPaused: process.env.NEWSROOM_AI_PAUSED === 'true', issues, totals: data.totals, latestLiveRunAt: live?.startedAt ?? null, latestCollectionAt: collection?.startedAt ?? null, latestMonitoringRunAt: monitored?.startedAt ?? null, runs: recent.slice(0, 30), staleRunIds: stale.map(run => run.id), alerts: data.alerts.slice(-30).map(({ runId: id, status, createdAt, finishedAt }) => ({ runId: id, status, createdAt, finishedAt })), ownerAlertsConfigured: ownerAlertConfiguration() !== null, eligibleDeliveryRecipients: new Set(deliveryRecipients.map(member => member.email.trim().toLowerCase())).size, counts: { stories: store.state.stories.length, waitingApproval: store.state.stories.filter(story => story.status === 'waiting_approval').length, blocked: store.state.stories.filter(story => story.status === 'blocked').length, publications: store.state.publications.length, inbox: store.inbox.length }, costNote: 'Estimates use explicitly configured model rates; unpriced runs are excluded from estimatedKnownCostUsd.' };
}

function ownerAlertConfiguration() {
  const recipient = process.env.NEWSROOM_OWNER_ALERT_EMAIL?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!recipient || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient) || !from || /[\r\n]/.test(from) || !process.env.RESEND_API_KEY) return null;
  return { recipient, from, key: process.env.RESEND_API_KEY };
}

/** Explicit owner action only. No function above sends mail. Ambiguous outcomes never trigger an automatic resend. */
export async function sendOwnerAlert(id: string, options: { transport?: typeof fetch } = {}) {
  runId.parse(id);
  const configuration = ownerAlertConfiguration();
  if (!configuration) return { status: 'not_configured' as const };
  const alertId = createHash('sha256').update(`owner-run-alert|${id}`).digest('hex');
  const claim = await updateDocument(key, initial, data => {
    const run = data.runs.find(item => item.id === id);
    if (!run || !['failed', 'interrupted'].includes(run.status)) throw new HttpError('Choose a failed or interrupted run for an owner alert.', 409);
    const existing = data.alerts.find(alert => alert.id === alertId);
    if (existing) return { send: false, status: existing.status };
    data.alerts.push({ id: alertId, runId: id, status: 'sending', createdAt: new Date().toISOString() });
    data.alerts = data.alerts.slice(-200);
    return { send: true, status: 'sending' as const };
  });
  if (!claim.send) return { status: claim.status };
  let status: AlertRecord['status'];
  try {
    const response = await (options.transport ?? fetch)('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${configuration.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `owner-alert-${alertId}` }, body: JSON.stringify({ from: configuration.from, to: [configuration.recipient], subject: 'Thursday Post newsroom needs attention', text: 'A newsroom research run did not complete successfully. Sign in to the owner newsroom and review Operations and the private audit. No source material or reader correspondence is included in this alert.' }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
    status = response.ok ? 'sent' : response.status >= 500 ? 'unknown' : 'failed';
    await response.body?.cancel();
  } catch { status = 'unknown'; }
  await updateDocument(key, initial, data => { const alert = data.alerts.find(item => item.id === alertId); if (alert) { alert.status = status; alert.finishedAt = new Date().toISOString(); } });
  return { status };
}
