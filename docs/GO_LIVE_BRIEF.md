# Thursday Post: production switchover

Owner instruction: use production now; customers are still weeks away. Deploy the tested code and complete real integrations. Do not repeat discovery or replace missing services with simulated success.

## Execute now

1. Deploy the tested research-resumption and story-review-link fixes to the existing Vercel project, `the-racing-desk` (Sydney Postgres). Keep credentials and stored content intact.

2. Keep AI unpaused and daily monitoring enabled. Default the newsroom to live research when ready; retain deliberate demo selection for diagnostics. Preserve bounded model quotas and explicit human publication/SEND controls.

3. Verify the deployed revision, owner login, actual live research/editorial usage, review links, persistent state and public access gates. Existing baseline: 125 passing tests, successful live research/PE handoff and hosted backup restore.

## Complete with real provider accounts

4. Email: connect Resend key, verified sender domain, dedicated inbound mailbox and separate signed inbound/delivery webhooks. Configure Gmail forwarding. Generate member session secret if absent. Exercise actual sign-in, reader intake, edition delivery and unsubscribe using an owner-controlled recipient explicitly approved for test messages.

5. Billing: connect Stripe production secret and signed webhook. Create/validate the owner's chosen monthly AUD price; verify canonical reconciliation, access, portal and cancellation. Open sales only with an actual configured offer. No invented price or test key presented as live.

6. Produce a real reviewed edition; release and SEND it deliberately. All six researcher disciplines and four editorial desks already have controlled integration coverage; production calls must show real evidence and recorded model usage.

## Remaining owner inputs if absent

Verified sending domain/Resend credentials; Stripe merchant activation/live credentials; monthly AUD price; test email recipient. Existing contacts remain workbenchadmin@gmail.com. Account verification, domain ownership and pricing decisions cannot be supplied by code.

## Handoff

See `docs/E2E_2026-09-12.md`, `scripts/verify-hosted-state.mjs`, `scripts/verify-live.mjs --run-live`, `scripts/e2e-mechanisms.ts`. Private credentials: ignored `.env.local` and existing Vercel settings. Never print or commit secrets. Reuse the existing infrastructure; do not create replacement projects. Record completed work and exact remaining blockers below.

## Execution record

Production deployment and readiness verification in progress.

### Recovery note — 12 September 2026

This brief was recovered from the owner's final Codex handoff after that session ended. At recovery time, GitHub `master` and `codex/launch-build` were identical at commit `493bbd4200ed1857adda9b3ee72c8af578f68b1d`. The referenced `E2E_2026-09-12.md` and `verify-live.mjs` files were not present in the remote repository, indicating the final Codex work described above had not yet been pushed. Do not claim those local-only changes as deployed until they are recovered or recreated and verified.