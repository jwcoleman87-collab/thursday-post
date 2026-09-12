# Thursday Post — production recovery record

Date: 12 September 2026 (Australia/Sydney)

## Recovered into source control

The final Codex production switchover was deployed from a dirty local working tree, so Vercel contained changes that were not safely represented in GitHub. The recoverable behavior has now been restored to `master` and verified through the normal CI pipeline.

Merged source commit: `bb1b98c4ed606518429196822c90ad21a8376536`

Recovered fixes:

1. **Interrupted live research resumes safely.** If a serverless invocation ends after a research task has been checkpointed as `running`, a later owner-triggered GO closes the orphaned task as interrupted once no live lease remains. Completed evidence and prior attempts remain archived, and the engine can allocate a fresh bounded later-run retry rather than leaving the story permanently stuck.
2. **Next-issue proof opens the real story review.** Story links from `/next-issue` now open `/editorial/[id]` directly rather than using an unused `/newsroom?story=...` query parameter.
3. **Regression coverage added.** The interrupted-task recovery path is covered by an automated test.

## Verification

Pull request #1 passed clean install, TypeScript typecheck, the full automated test suite and the production Next.js build. After merge, `master` commit `bb1b98c4ed606518429196822c90ad21a8376536` independently passed the same clean install, typecheck, test and production-build workflow.

No publication, edition release or SEND approval gate was weakened or automated by this recovery.

## Production deployment state

The known production switchover deployment remains Vercel deployment `dpl_2uA5JGd3FYGn6Ygdk5qL3x7aHDV3`, project `the-racing-desk`, tagged `20260912-live-research-recovery`. Its deployment metadata showed `gitDirty=1`, which is why this source-control recovery was required.

At the time this record was written, the connected Vercel integration returned HTTP 403 for the project team scope (`jwcoleman87-collabs-projects`). Therefore this record does **not** claim that `bb1b98c` has been redeployed cleanly from GitHub. Re-authenticate the existing Vercel scope, then deploy/verify the existing project; do not create a replacement project.

## Security finding

GitHub currently reports `jwcoleman87-collab/thursday-post` as **public**. No secrets were intentionally committed during this recovery, and provider secrets must remain in private environment configuration. If the repository is intended to be private, change its GitHub visibility using the owner account before treating the source repository as confidential.

## Remaining real-provider work

- Resend: verified sending domain, real API credential, dedicated inbound mailbox, signed inbound/delivery webhooks, Gmail forwarding, member session secret if absent, and real delivery/unsubscribe test.
- Stripe: production merchant activation/live credentials, signed webhook, chosen monthly AUD price, and real checkout/access/portal/cancellation reconciliation.
- Produce and review a real edition before deliberately releasing and sending it.

Do not substitute fixtures, invented credentials, simulated delivery, or a replacement Vercel project for these remaining provider-backed checks.
