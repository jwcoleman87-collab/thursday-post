# Thursday Post overnight build — 10 September 2026

Application implementation is deployed and verified. The project is not open for paying customers: the remaining account, price and publisher decisions are listed in MORNING_START.md and LAUNCH_CHECKLIST.md.

## AI activation follow-up — 10 September

Latest: James completed card verification and saved the US$5 monthly project limit. OIDC preflight succeeded. Deployment `dpl_9DYQiDoEywdsTk4sXGsPMTdAJ9hz` enabled live AI; the first complete hosted run (`2b6a98ca-8485-4b0c-b994-900440b26e2f`) failed: four research responses had quotations absent from their source excerpts, then immediate retries hit HTTP429. Usage was 6,978 input / 2,600 output tokens, estimated US$0.0069512; no researcher completed and no PE model proposal was produced. Five live records are archived and zero public articles exist. AI is paused again, daily source collection remains enabled, and `CLAUDE_FINISH_PROMPT.md` contains the precise next repair/verification instructions. This latest record supersedes the account-verification blocker below.

James requested prioritising AI/research/PE operation and setting Stripe aside. This supersedes the earlier decision to defer AI activation, but does not authorise an unspecified paid budget or top-ups. A fresh project OIDC preflight returned HTTP 403 `customer_verification_required`; Vercel login/card verification is pending. AI remains paused until that access test succeeds.

Hosted source collection succeeded again, adding one record (three real records now archived). Daily monitoring is enabled; the existing cron collects sources while AI is paused. Nothing was published or emailed. The first scheduled invocation after enabling has not yet been observed.

Fixed PE failure reporting so a quotation fallback cannot be recorded as a completed AI editor call. Added five controlled adapter-to-engine integration tests covering every research role and PE desk, ordering, evidence and failure gates; 113 total tests and the production build pass. The live verification script now requires actual successful preflight/research/editorial usage, a PE proposal, no fresh operational failures and an unchanged public article count. Controlled tests do not prove live provider operation; the hosted live run is still pending access.

The earlier evidence and authorisation below record the overnight state; this follow-up takes precedence for AI activation and monitoring.

## Authorisation that remains in force
- Only Thursday Post work. Reader contact is workbenchadmin@gmail.com; infrastructure identities stay unchanged.
- Sales must remain closed until James chooses/validates the monthly AUD price and explicitly opens them.
- Live AI remains paused. No card, domain purchase, paid upgrade or new service budget was authorised.
- Existing Stripe account use is authorised, but its browser remains on the sign-in page. James completes verification himself.
- Article approval, edition release and SEND remain separate explicit owner actions. No outreach, fabricated readers or autonomous publication.

## Completed
- Editorial revisions, evidence-gap resolution, right-of-reply invalidation/reconfirmation, corrections and withdrawal.
- Persistent member sign-in, consent, server paywall, Stripe lifecycle integration with test/live isolation and closed-sales controls.
- Ordered reviewed editions, member archive/print, explicit delivery queue, retries, unsubscribe and bounce/complaint suppression.
- Source-only collection with AI paused, collected backlog research, bounded retrieval, run records, usage/cost estimates, health and owner alert controls.
- Private backup export and restore tools; hosted export restored into a new local SQLite file with verified integrity.
- Broadsheet reader pages, draft Thursday-at-post mark, policy/contact/Post Box pages and the latest subscription-only GitHub homepage preserved and wired to real readiness.
- Safe member secret and canonical site URL configured in the approved Vercel project.
- One-page Claude handoff, current launch checklist, morning startup and operations/recovery guides.

## Evidence
- 107/107 tests pass; TypeScript and local/Vercel production builds pass.
- Browser desktop/mobile layouts and reader/owner navigation checked; no application errors or page-wide overflow observed.
- Hosted owner APIs/checkout reject anonymous access (401), owner login 200, live GO intentionally paused (503), private demo GO 200, real source collection 200.
- Two live source records retained; no active run lease, monitoring paused, zero public articles, zero payments and no outbound email.
- Payment/email lifecycle tests use controlled transports. Actual Stripe/member-email/delivery provider journeys are still pending connection.

## Repository and hosting
- Private GitHub: https://github.com/jwcoleman87-collab/thursday-post
- Website: https://the-racing-desk.vercel.app ; owner /newsroom ; operations /operations ; paper /news.
- Branch codex/launch-build incorporates newer origin/master homepage commits through 45e317f. No existing work was discarded.
- CLI deployments remain explicit. GitHub Actions runs checks; it does not auto-deploy unreviewed changes against live data.
- Final application deployment: dpl_7VqJDU4Uh3wjBiGvaP56RW6kgG89 (READY), revision 39c8026. GitHub Actions run 34366126685 passed clean install, typecheck, all 107 tests and build. Code and guides have been uploaded to master and codex/launch-build.

## Remaining work needs external inputs
Stripe sign-in/verification and keys, monthly price, domain and verified Resend sending/receiving, Gmail forwarding, AI verification/budget/activation, commercial business/hosting/rights details, exact design template/artwork, genuine editorial trial editions and pilot customers. Provider-backed purchase/payout/delivery tests must follow those connections. Offsite retention/backups and remote Postgres restoration are still operating setup work.

Overnight heartbeat: finish-thursday-post-overnight. The scheduled follow-up is being paused after successful upload and verification; resume when James supplies actionable inputs. Do not spend repeated runs restating unchanged dependencies.
