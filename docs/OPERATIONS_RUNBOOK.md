# Thursday Post operations and recovery

The owner Operations screen reports durable newsroom runs, failed or stale work, daily monitoring gaps, token usage and the exact number of currently eligible email recipients. It does not include reader email addresses, source bodies, credentials or provider error responses.

## Run integration

The service now calls these around every lease-protected research run and source-only collection:

```ts
await beginRunRecord(mode, leaseId);
// Perform the existing run, retaining the provider instance for its usage records.
await finishRunRecord(leaseId, { status: 'completed', usage: provider?.usage });
// In the failure path:
await finishRunRecord(leaseId, { status: 'failed', error, usage: provider?.usage });
```

Run modes are `demo`, `live` and `collect`. Source collection records use no model. Recovering an expired lease marks its existing durable run record interrupted before starting the replacement. Completed model calls are captured through the provider's `usage` array. A live run includes previously collected, unassigned source records, so manual collection remains available for later research even if the original feed item disappears.

The authenticated daily cron first processes up to two delivery jobs from campaigns previously queued by James's explicit SEND action. It does this even while source monitoring is paused. It never creates a new campaign or sends an owner alert. If monitoring is enabled while AI is paused, cron collects sources only; otherwise it runs live research. The shared invocation budget is 270 seconds, leaving headroom under the 300-second hosted limit. Collection and engine network work respect the remaining absolute deadline; a slow database or forced platform termination can still require lease recovery.

`beginRunRecord` and `finishRunRecord` are idempotent while the run remains in the retained record set. Completed records are not rewritten by repeated completion calls. The latest 200 run records are retained, with cumulative counters. Failed runs persist fixed error categories; raw exception strings are never saved in the operations document.

The owner can mark a record interrupted only when it has been running for more than ten minutes and no current newsroom lease is active. This records the operational outcome; it does not terminate a running process or bypass editorial approval. No recorded live research or source collection in 26 hours produces a monitoring warning when monitoring is enabled. This assumes the existing daily schedule. Paused monitoring is shown explicitly.

`operationsPayload()` returns health, recent safe run records, counts and `eligibleDeliveryRecipients`. Eligibility is recalculated from the current member and consent state. Delivery itself must recheck eligibility because the count can change after the owner reviews it.

## Token usage and optional estimates

Every completed provider call can contribute `{model, stage, inputTokens, outputTokens}`. Stages are `preflight`, `research` or `editorial`. Missing token usage remains missing; an unpriced run is not treated as free.

Dollar estimates are available only when an operator explicitly supplies `NEWSROOM_MODEL_PRICES_JSON` with current USD rates, for example:

```json
{"provider/model":{"inputUsdPerMillion":1.25,"outputUsdPerMillion":5}}
```

Those numbers are an illustrative configuration shape, not a quoted model price. Use the actual selected provider/model and verified rates. Missing rates, invalid configuration or incomplete token counts produce `estimatedUsd: null`. `estimatedKnownCostUsd` excludes unpriced runs and is an estimate, not an invoice, spending cap or provider billing reconciliation.

## Owner alerts

Optional owner alert delivery requires all three settings:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` for a verified sending identity
- `NEWSROOM_OWNER_ALERT_EMAIL`, containing exactly one email address

`sendOwnerAlert(runId)` is an explicit owner action for a failed or interrupted run. Beginning or finishing a run never sends mail. The message goes only to the configured owner address and contains a generic instruction to inspect Operations. It contains no source material or reader correspondence.

The durable alert record and Resend idempotency key prevent repeated submissions for the same retained run. An uncertain network/provider outcome is shown as `unknown`; it is not automatically retried. Inspect the provider dashboard before arranging another message. This avoids duplicate messages when delivery succeeded but the response was lost. Keep monitoring private until live model and source operation have been checked.

## Private backup download

An authenticated owner can download `/api/owner/backup`. The response is an attachment with `private, no-store` caching. There is no HTTP restore endpoint.

The backup contains the entire main newsroom store and every named durable document, including original reader messages, member records, delivery state and private evidence. Treat it as confidential account data. It contains no environment variables or database connection strings. Keep copies in private encrypted storage, separate from the application host; do not put them in source control or share them publicly.

The versioned JSON envelope records creation time, a one-way source database identity and a SHA-256 integrity digest. The digest detects accidental corruption or changes; it is not encryption or proof that a file came from a trusted person. Obtain backups from a trusted owner session or the local CLI.

Exports compare the main store and document revisions across a stable window. An active newsroom lease blocks export; concurrent document writes can require a retry. The supported backup size is 64 MB. Larger archives need a database-native backup workflow instead of increasing the web request size without reviewing resource usage.

Take a copy after releasing an edition and before a schema or infrastructure change. This implementation provides export and restore tools; it does not configure provider snapshots, an offsite backup schedule or a retention service. Record and test those operational arrangements separately.

## CLI backup

Run from the project directory with Node 22.13 or later and the installed project dependencies. Use the application's existing explicit environment settings. The output file must not already exist.

```powershell
node --env-file=.env.local --import tsx scripts/backup.mjs --output data/backups/edition-001.json
```

For hosted data, load the authorised source `DATABASE_URL` privately into the process environment. Never paste a connection string into a command argument, log or document. The CLI prints only revision/count summaries. It refuses a missing local source database and never overwrites an existing output file.

## Isolated restore drill

Restore into a new local filename first:

```powershell
node --import tsx scripts/restore-backup.mjs --input data/backups/edition-001.json --sqlite data/restore-drill/edition-001.sqlite
```

The target must be new and different from the source identity and all configured local databases. The tool uses exclusive file creation, restores both tables in one transaction, compares restored data and checks SQLite integrity. Existing targets, symlinks to existing files and source paths are rejected. A failed new target is retained for inspection and is never substituted for the live database.

The restore preserves the saved state exactly, including monitoring settings, run records and delivery jobs. Do not boot the restored copy with live provider, scheduler or sending credentials during a drill. Inspect it using a separate local configuration, verify representative publications, original evidence and member records, and document the recovery result before planning a live cutover.

An optional Postgres restore requires an explicitly different, empty database. Put its connection privately into a separate environment variable, then name that variable:

```powershell
node --import tsx scripts/restore-backup.mjs --input data/backups/edition-001.json --postgres-env RESTORE_DATABASE_URL
```

The CLI rejects `DATABASE_URL` as a target-variable name. The library also compares credential-independent source/target identities and rejects the configured live database. Any existing application table rejects the target. Creation, insertion and data comparison occur in one transaction; failures roll back. Connection strings and raw database errors are never printed. No remote restore was exercised by automated tests; provision and verify an isolated target before using this route operationally.

## API contracts

- `GET /api/owner/operations`: authenticated safe health payload.
- `POST /api/owner/operations`: authenticated, same-origin JSON `{action: "alert" | "mark_interrupted", runId}` with a 4 KB request limit.
- `GET /api/owner/backup`: authenticated private JSON attachment; maximum 64 MB.
- `createBackup()`, `parseBackup(input)`, `restoreBackupToNewSqlite(backup, filename)`, `restoreBackupToNewPostgres(backup, targetConnection)` are exported by `src/lib/backup.ts`.

The operations and backup tests use isolated temporary SQLite databases and a fake mail transport. They verify record idempotency, redacted errors, explicit pricing, monitoring gaps, authenticated download, cross-origin rejection, backup integrity, complete round-trip recovery and refusal to overwrite existing/source targets. They do not send real email or contact a remote database.
