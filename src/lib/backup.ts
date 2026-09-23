import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import { AutonomousProgressSchema } from './autonomous-contract';
import { HttpError } from './auth';
import { exportDocuments } from './durable-store';
import { readStore, type StoreData } from './store';

export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export interface NewsroomBackup {
  format: 'thursday-post-backup'; version: 1; createdAt: string;
  source: { kind: 'sqlite' | 'postgres'; identity: string };
  payload: { store: StoreData; documents: { id: string; payload: unknown; revision: number }[] };
  integrity: { algorithm: 'sha256'; digest: string };
}
const identifier = z.string().min(1).max(300);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const mode = z.enum(['demo', 'live']);
const researchId = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const peId = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const sourceType = z.enum(['official', 'publication', 'email', 'social', 'media', 'data']);
const mediaSchema = z.object({ id: identifier, url: z.string(), sourceId: identifier, earliestSource: z.string().nullable(), proposedCaption: z.string(), context: z.enum(['verified', 'unknown', 'contradicted']), date: z.string().nullable(), location: z.string().nullable(), manipulation: z.enum(['not_detected', 'detected', 'unknown']), aiStatus: z.enum(['generated', 'modified', 'no_evidence', 'unknown']), reuseHistory: z.array(z.string()), captionSupported: z.boolean(), rights: z.enum(['cleared', 'unknown']), allowed: z.boolean() }).strict();
const sourceSchema = z.object({ id: identifier, title: z.string(), content: z.string(), url: z.string(), type: sourceType, sourceName: z.string(), independenceKey: z.string(), publishedAt: timestamp, retrievedAt: timestamp, rawOriginal: z.string().optional(), publishedAtKnown: z.boolean().optional(), region: z.string().optional(), topics: z.array(z.string()).optional(), isCorrection: z.boolean().optional(), relatedStoryId: z.string().optional(), demo: z.boolean().optional(), media: z.array(mediaSchema).optional(), email: z.object({ messageId: z.string(), from: z.string(), subject: z.string(), receivedAt: timestamp, original: z.string(), headers: z.array(z.object({ key: z.string(), line: z.string() }).strict()).optional(), attachments: z.array(z.object({ filename: z.string(), contentType: z.string(), size: z.number().nonnegative(), checksum: z.string().optional() }).strict()).optional(), originalEncoding: z.enum(['utf8', 'base64']).optional() }).strict().optional() }).strict();
const evidenceSchema = z.object({ id: identifier, sourceId: identifier, quote: z.string(), relation: z.enum(['supports', 'contradicts']), exactMatch: z.boolean(), independenceKey: z.string(), recordedAt: timestamp }).strict();
const claimSchema = z.object({ id: identifier, text: z.string(), kind: z.enum(['record_statement', 'fact', 'opinion', 'inference', 'allegation']), agentId: researchId, evidence: z.array(evidenceSchema), status: z.enum(['verified', 'unverified', 'disputed']), verificationScope: z.enum(['source_statement', 'underlying_fact', 'unverified']), confidence: z.enum(['low', 'medium', 'high']), questions: z.array(z.string()), createdAt: timestamp }).strict();
const sentenceSchema = z.object({ text: z.string(), claimIds: z.array(identifier), humanReviewed: z.boolean().optional() }).strict();
const draftSchema = z.object({ id: identifier, headline: z.string(), byline: z.string(), peAgentId: peId, sentences: z.array(sentenceSchema), body: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestamp, limitations: z.array(z.string()), factReview: z.object({ actor: z.literal('James'), note: z.string(), reviewedAt: timestamp }).strict().optional(), assessorReview: z.object({ actor: z.literal('newsroom-assessor'), authorisingOwner: z.literal('James'), note: z.string(), reviewedAt: timestamp, evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), headlineClaimIds: z.array(identifier) }).strict().optional(), reviewRevision: z.number().int().nonnegative().optional(), label: z.enum(['opinion', 'analysis', 'update', 'correction', 'right_of_reply']).optional(), deck: z.string().optional(), dateline: z.string().optional(), captions: z.array(z.object({ mediaId: identifier, text: z.string(), sourceIds: z.array(identifier) }).strict()).optional(), access: z.enum(['public', 'members']).optional() }).strict();
const findingSchema = z.object({ id: identifier, storyId: identifier, taskId: identifier, agentId: researchId, claimIds: z.array(identifier), summary: z.string(), createdAt: timestamp }).strict();
const scopeAssessmentSchema = z.object({ outcome: z.literal('not_required_for_scope'), rationale: z.string(), assessor: z.literal('newsroom-assessor'), authorisingOwner: z.literal('James'), claimIds: z.array(identifier), draftHash: z.string().regex(/^[a-f0-9]{64}$/), evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), assessedAt: timestamp }).strict();
const gapSchema = z.object({ id: identifier, question: z.string(), agentId: researchId, status: z.enum(['open', 'resolved']), blocking: z.boolean(), resolution: z.string().optional(), scopeAssessment: scopeAssessmentSchema.optional(), claimIds: z.array(identifier), createdAt: timestamp }).strict();
const complianceSchema = z.object({ id: identifier, gate: z.enum(['evidence', 'imagery', 'wagering', 'publication']), status: z.enum(['passed', 'blocked', 'warning', 'not_applicable']), message: z.string(), checkedAt: timestamp }).strict();
const approvalSchema = z.object({ id: identifier, decision: z.enum(['approve', 'reject', 'send_back']), note: z.string(), actor: z.literal('James'), draftHash: z.string().nullable(), wageringAcknowledged: z.boolean(), createdAt: timestamp }).strict();
const storySchema = z.object({ autonomy: AutonomousProgressSchema.optional(), id: identifier, title: z.string(), summary: z.string(), mode, status: z.enum(['candidate', 'researching', 'drafting', 'waiting_approval', 'blocked', 'published', 'rejected', 'sent_back']), selectedReason: z.string(), researchAgentIds: z.array(researchId), peAgentId: peId, sourceItems: z.array(identifier), claims: z.array(claimSchema), findings: z.array(findingSchema), gaps: z.array(gapSchema), approvals: z.array(approvalSchema), compliance: z.array(complianceSchema), media: z.array(mediaSchema), wagering: z.boolean(), draft: draftSchema.optional(), draftHistory: z.array(draftSchema).optional(), proposedDraft: z.object({ headline: z.string(), sentences: z.array(sentenceSchema), researchRequests: z.array(z.object({ agentId: researchId, question: z.string() }).strict()).optional(), createdAt: timestamp, status: z.literal('requires_human_review') }).strict().optional(), correctionOf: z.string().optional(), correctionReason: z.string().optional(), access: z.enum(['public', 'members']).optional(), publishedEvidenceAlerts: z.array(z.object({ sourceIds: z.array(identifier), receivedAt: timestamp, status: z.enum(['open', 'reviewed']) }).strict()).optional(), editorialTone: z.enum(['A', 'B', 'N']).optional(), rightOfReply: z.object({ status: z.enum(['not_required', 'requested', 'received', 'declined', 'no_response']), note: z.string(), recipient: z.string().optional(), requestedAt: timestamp.optional(), deadline: timestamp.optional(), sourceIds: z.array(identifier), recordedAt: timestamp, actor: z.literal('James') }).strict().optional(), error: z.string().optional(), createdAt: timestamp, updatedAt: timestamp }).strict();
const publicationStatus = z.enum(['published', 'retracted', 'removed']);
const publicationSchema = z.object({ id: identifier, storyId: identifier, mode, public: z.boolean(), draftHash: z.string().regex(/^[a-f0-9]{64}$/), draft: draftSchema, approvedBy: z.literal('James'), approvedAt: timestamp, publishedAt: timestamp, status: publicationStatus.optional(), statusHistory: z.array(z.object({ status: publicationStatus, note: z.string(), actor: z.literal('James'), createdAt: timestamp }).strict()).optional(), correctionOf: z.string().optional(), correctionReason: z.string().optional(), access: z.enum(['public', 'members']).optional() }).strict();
const stateSchema = z.object({ gatewayNotBefore:z.number().nonnegative().optional(), schemaVersion: z.literal(1), stories: z.array(storySchema), sourceItems: z.array(sourceSchema), tasks: z.array(z.object({ id: identifier, storyId: identifier, agentId: researchId, round: z.number().int().nonnegative(), question: z.string(), status: z.enum(['pending', 'running', 'completed', 'failed']), attempts: z.number().int().nonnegative(), error: z.string().optional(), createdAt: timestamp, finishedAt: timestamp.optional() }).strict()), runs: z.array(z.object({ id: identifier, storyId: identifier, agentType: z.enum(['research', 'editorial', 'form']), agentId: z.number().int(), taskId: z.string().optional(), status: z.enum(['completed', 'failed']), summary: z.string(), startedAt: timestamp, finishedAt: timestamp }).strict()), audit: z.array(z.object({ id: identifier, storyId: z.string().optional(), action: z.string(), detail: z.string(), createdAt: timestamp }).strict()), publications: z.array(publicationSchema), lastRunAt: timestamp.optional() }).strict();
const storeSchema: z.ZodType<StoreData> = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), state: stateSchema, sources: z.array(z.object({ id: identifier, name: z.string(), url: z.string(), allowedHosts: z.array(z.string()), format: z.enum(['rss', 'html']), type: sourceType, region: z.string(), enabled: z.boolean(), termsReviewedAt: timestamp.optional(), articlePathPrefix: z.string().optional(), notes: z.string() }).strict()), inbox: z.array(sourceSchema), monitoring: z.boolean(), autoPublish: z.boolean().optional(), sourceCursor: z.number().int().nonnegative(), lease: z.object({ id: identifier, expiresAt: timestamp, mode }).strict().optional(), loginAttempts: z.record(z.string(), z.object({ count: z.number().int().nonnegative(), until: z.number().nonnegative() }).strict()) }).strict();
const backupSchema = z.object({ format: z.literal('thursday-post-backup'), version: z.literal(1), createdAt: z.string().datetime(), source: z.object({ kind: z.enum(['sqlite', 'postgres']), identity: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), payload: z.object({ store: storeSchema, documents: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9._-]{0,99}$/), payload: z.json(), revision: z.number().int().nonnegative() }).strict()).max(1000) }).strict(), integrity: z.object({ algorithm: z.literal('sha256'), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict();

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function sqliteIdentity(filename: string): string {
  const absolute = resolve(filename);
  const canonicalPath = existsSync(absolute) ? realpathSync(absolute) : existsSync(dirname(absolute)) ? resolve(realpathSync(dirname(absolute)), absolute.slice(dirname(absolute).length + 1)) : absolute;
  return digest({ kind: 'sqlite', path: process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath });
}
function postgresIdentity(connection: string): string {
  let url: URL;
  try { url = new URL(connection); } catch { throw new HttpError('Use a valid explicit Postgres restore target.', 400); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') throw new HttpError('Use a valid explicit Postgres restore target.', 400);
  return digest({ kind: 'postgres', host: url.hostname.toLowerCase().replace(/-pooler(?=\.)/, ''), port: url.port || '5432', database: decodeURIComponent(url.pathname) });
}

export function parseBackup(input: string | Buffer | unknown): NewsroomBackup {
  try {
    if ((typeof input === 'string' || Buffer.isBuffer(input)) && Buffer.byteLength(input) > MAX_BACKUP_BYTES) throw new Error('size');
    const value = typeof input === 'string' || Buffer.isBuffer(input) ? JSON.parse(input.toString()) : input;
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BACKUP_BYTES) throw new Error('size');
    const parsed = backupSchema.parse(value);
    if (new Set(parsed.payload.documents.map(document => document.id)).size !== parsed.payload.documents.length) throw new Error('duplicate namespace');
    const { integrity, ...envelope } = parsed;
    if (!timingSafeEqual(Buffer.from(integrity.digest, 'hex'), Buffer.from(digest(envelope), 'hex'))) throw new Error('integrity');
    return parsed;
  } catch { throw new HttpError('Backup validation or integrity verification failed. Restore requires an intact supported backup no larger than 64 MB.', 400); }
}

/** Matching revision snapshots provide a consistent aggregate/document window without holding locks across awaits. */
export async function createBackup(): Promise<NewsroomBackup> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const firstStore = await readStore();
    if (firstStore.lease && Date.parse(firstStore.lease.expiresAt) > Date.now()) throw new HttpError('Wait for the active newsroom run to finish before exporting a backup.', 409);
    const firstDocuments = await exportDocuments();
    const secondStore = await readStore();
    const secondDocuments = await exportDocuments();
    if (digest(firstStore) !== digest(secondStore) || digest(firstDocuments) !== digest(secondDocuments)) continue;
    const envelope = { format: 'thursday-post-backup' as const, version: 1 as const, createdAt: new Date().toISOString(), source: process.env.DATABASE_URL ? { kind: 'postgres' as const, identity: postgresIdentity(process.env.DATABASE_URL) } : { kind: 'sqlite' as const, identity: sqliteIdentity(process.env.NEWSROOM_DB_FILE || 'data/newsroom.sqlite') }, payload: { store: firstStore, documents: firstDocuments } };
    return parseBackup({ ...envelope, integrity: { algorithm: 'sha256', digest: digest(envelope) } });
  }
  throw new HttpError('The newsroom changed during export. Retry after pending writes finish.', 409);
}

/** Restore only creates a new local database; exclusive creation rejects files, symlinks and accidental overwrites. */
export function restoreBackupToNewSqlite(input: NewsroomBackup | string | Buffer, filename: string) {
  const backup = parseBackup(input);
  if (!filename.trim()) throw new HttpError('Choose an explicit new local SQLite target.', 400);
  const target = resolve(filename);
  const configured = [process.env.NEWSROOM_DB_FILE || 'data/newsroom.sqlite', process.env.NEWSROOM_DOCUMENT_DB_FILE].filter((value): value is string => Boolean(value)).map(sqliteIdentity);
  if (existsSync(target) || configured.includes(sqliteIdentity(target)) || (backup.source.kind === 'sqlite' && backup.source.identity === sqliteIdentity(target))) throw new HttpError('Restore target must be a new local database, separate from every configured source database.', 409);
  mkdirSync(dirname(target), { recursive: true });
  // Recheck the resolved parent after creating directories, then reserve the filename atomically.
  if (configured.includes(sqliteIdentity(target)) || (backup.source.kind === 'sqlite' && backup.source.identity === sqliteIdentity(target))) throw new HttpError('Restore target resolves to a source database.', 409);
  let file: number;
  try { file = openSync(target, 'wx', 0o600); } catch { throw new HttpError('Restore target already exists or cannot be created.', 409); }
  closeSync(file);
  const db = new DatabaseSync(target);
  try {
    db.exec('PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE; CREATE TABLE newsroom (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE newsroom_documents (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)');
    db.prepare('INSERT INTO newsroom(id,payload) VALUES(1,?)').run(JSON.stringify(backup.payload.store));
    const insert = db.prepare('INSERT INTO newsroom_documents(id,payload,revision) VALUES(?,?,?)');
    for (const document of backup.payload.documents) insert.run(document.id, JSON.stringify(document.payload), document.revision);
    const restored = db.prepare('SELECT payload FROM newsroom WHERE id=1').get() as { payload: string };
    const restoredDocuments = (db.prepare('SELECT id,payload,revision FROM newsroom_documents ORDER BY id').all() as { id: string; payload: string; revision: number }[]).map(document => ({ ...document, payload: JSON.parse(document.payload) }));
    const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (digest(JSON.parse(restored.payload)) !== digest(backup.payload.store) || digest(restoredDocuments.sort(byId)) !== digest([...backup.payload.documents].sort(byId))) throw new Error('restore mismatch');
    db.exec('COMMIT');
    const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (check.integrity_check !== 'ok') throw new Error('integrity');
  } catch { try { db.exec('ROLLBACK'); } catch { /* The new file is retained for inspection, never overwritten or deleted automatically. */ } throw new HttpError('Restore failed. The isolated target is retained; the source database was not changed.', 500); }
  finally { db.close(); }
  return { target, documents: backup.payload.documents.length, storeRevision: backup.payload.store.revision, verified: true as const };
}

/** Remote restore requires a different, empty database. There is deliberately no HTTP restore endpoint. */
export async function restoreBackupToNewPostgres(input: NewsroomBackup | string | Buffer, targetConnection: string) {
  const backup = parseBackup(input);
  const identity = postgresIdentity(targetConnection);
  if ((backup.source.kind === 'postgres' && backup.source.identity === identity) || (process.env.DATABASE_URL && postgresIdentity(process.env.DATABASE_URL) === identity)) throw new HttpError('Postgres restore target must differ from the source and configured live database.', 409);
  const sql = postgres(targetConnection, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => undefined });
  try {
    await sql.begin(async tx => {
      const tables = await tx`SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') LIMIT 1`;
      if (tables.length) throw new HttpError('Postgres restore requires an empty target database.', 409);
      await tx`CREATE TABLE newsroom (id integer PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL)`;
      await tx`CREATE TABLE newsroom_documents (id text PRIMARY KEY, payload jsonb NOT NULL, revision integer NOT NULL DEFAULT 0)`;
      await tx`INSERT INTO newsroom(id,payload) VALUES(1,${tx.json(backup.payload.store as never)})`;
      for (const document of backup.payload.documents) await tx`INSERT INTO newsroom_documents(id,payload,revision) VALUES(${document.id},${tx.json(document.payload as never)},${document.revision})`;
      const [row] = await tx`SELECT payload FROM newsroom WHERE id=1`;
      const documents = await tx<{ id: string; payload: unknown; revision: number }[]>`SELECT id,payload,revision FROM newsroom_documents ORDER BY id`;
      const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      if (digest(row.payload) !== digest(backup.payload.store) || digest([...documents].sort(byId)) !== digest([...backup.payload.documents].sort(byId))) throw new Error('restore mismatch');
    });
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError('Postgres restore failed. No source database was changed and the target transaction was rolled back.', 500); }
  finally { await sql.end({ timeout: 3 }); }
  return { documents: backup.payload.documents.length, storeRevision: backup.payload.store.revision, verified: true as const };
}
