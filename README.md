# Thursday Post

The publication is **Thursday Post**; its logo is Thursday the horse standing at his post. The current UI still uses the earlier “The Racing Desk” placeholder. Start with [`docs/CLAUDE_UI_HANDOFF.md`](docs/CLAUDE_UI_HANDOFF.md) for the UI-only branding and design handoff. Existing deployment/project names remain unchanged.

A lean Australian thoroughbred newsroom: GO → discovery → six specialist research roles → shared evidence hub → targeted follow-up → four PE desks → compliance → James’s decision → public edition.

## Deployed status

The [newsroom](https://the-racing-desk.vercel.app) and [public newspaper](https://the-racing-desk.vercel.app/news) are deployed in Vercel’s `jwcoleman87-collabs-projects` account, with a free Neon Postgres database in Sydney. Owner access details are stored privately in `data/OWNER-ACCESS.txt`; do not commit or share that file. Hosted checks confirmed anonymous operator access returns 401, owner login succeeds, and the public endpoint returns 200.

James has chosen to leave live AI research pending. AI Gateway returned `403 customer_verification_required` and requires a card on file. `NEWSROOM_AI_PAUSED=true` now blocks live GO with 503 before any model request. The deployed app and deterministic demo work; live research agents are not operating. Monitoring remains paused, and no article has been approved for public publication.

The confirmed reader address is **workbenchadmin@gmail.com**. Saved `.eml` imports work. Automatic Gmail forwarding is not connected; it still needs the dedicated Resend receiving configuration below. Existing Vercel and other infrastructure account identities remain separate.

## Run on this computer

Requires Node.js 22.13 or later (built and tested using Node 24).

```powershell
npm install
npm run setup
npm test
npm run build
npm start
```

Open [the newsroom](http://127.0.0.1:3000) and press **GO · Run newsroom** in Demo mode. See [the public edition](http://127.0.0.1:3000/news). The setup script creates unique secrets in ignored `.env.local`; it never overwrites existing configuration. The local server binds only to this computer. `LOCAL_DEMO_ACCESS=true` permits local operator access; this bypass is always disabled on Vercel. Set it to `false` to test the password sign-in at `/login`. The password is the `ADMIN_PASSWORD` value in `.env.local`.

SQLite stores your local data in `data/newsroom.sqlite`, including original reader emails. Stop the server before backing up the entire `data` folder. Do not commit or upload that folder. Test fixtures run in separate temporary databases.

## What is implemented

- Six exact research disciplines and four exact PE desks, with separate prompts and run records. Public bylines are Agent 1–4.
- Source registry, bounded RSS/Atom and public HTML collection, robots checks, DNS-pinned SSRF protections, source fingerprints and deduplication.
- Claim → evidence → original-source traceability, including contradictory/unverified material and immutable source revisions.
- Bounded parallel research, retry limits, targeted follow-up, durable checkpoints, expiring run leases, and visible blocked/error states.
- Article drafts, imagery provenance/rights fields, private original-email retention, correction priority and signed Resend inbound delivery.
- Approval/reject/send-back actions. Approval is bound to the exact draft displayed; the server rechecks its hash, evidence and current policy. Published articles are immutable snapshots.
- Public newspaper archive and story views. Demo approvals remain private simulations and never enter the public API.
- Configurable wagering policy that blocks publication until a current review is recorded; separate sourced form shortlist logic in `analyseForm`.
- Daily Vercel monitoring, paused by default. GO works independently of cron.

## Connect live services

Use `.env.example` as the configuration reference. Set keys privately in Vercel or `.env.local`; never paste credentials into source code or a public repository.

| Setting | Purpose |
|---|---|
| `NEWSROOM_CONTACT_EMAIL` | Confirmed reader correspondence address: `workbenchadmin@gmail.com`. |
| `DATABASE_URL` | Dedicated Postgres database for the hosted newsroom. No temporary filesystem fallback on Vercel. |
| `AUTH_SECRET`, `ADMIN_PASSWORD` | Protected James login. Setup generates strong values. |
| `AI_GATEWAY_API_KEY`, `NEWSROOM_MODEL` | Optional Gateway API key and selected `provider/model`; Vercel can use its OIDC identity. Account verification is still required. Demo mode makes no model calls. |
| `NEWSROOM_AI_PAUSED` | Currently `true`, by James’s choice. Blocks live GO before an API call; Demo mode remains available. |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Authenticate incoming reader emails. |
| `NEWSROOM_INBOUND_ADDRESS` | Dedicated Resend receiving address accepted by the inbound adapter. Separate from the public Gmail contact. |
| `RESEND_FROM_EMAIL` | Reserved for a verified sending domain; separate from the reader reply address. This release does not send newsletters. |
| `CRON_SECRET` | Authenticates daily scheduler requests; use a random value of at least 32 characters. |
| `NEWSROOM_MODE` | Initial UI mode: `demo` or `live`. |

The existing production project and database are configured. Keep secrets in their deployment environment, keep `LOCAL_DEMO_ACCESS=false` when hosted, and never point tests at the production database.

1. When James elects to resume AI setup, complete [AI Gateway account verification](https://vercel.com/docs/ai-gateway), set `NEWSROOM_AI_PAUSED=false` in production and preview, and redeploy. Test live GO before enabling monitoring. Live research uses a bounded corpus of retrieved source items. Enable permitted sources in Settings and inspect the fetch audit.
2. For automatic reader email, configure [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction), a dedicated receiving address, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `NEWSROOM_INBOUND_ADDRESS`. Register `https://the-racing-desk.vercel.app/api/webhooks/resend` for `email.received`. The adapter verifies signed delivery and the configured recipient before archiving the original message. Configure forwarding from `workbenchadmin@gmail.com` in Gmail; changing the contact setting does not grant mailbox access. Inbox `.eml` import remains available meanwhile.
3. Leave monitoring paused until live source and model operation is verified. Enable it in Settings when ready. `vercel.json` schedules one daily call at 20:00 UTC (06:00 Sydney standard time; 07:00 during daylight saving). Every scheduled run still stops at James’s approval gate.

Infrastructure account emails stay with their existing services. The app does not replace Vercel account identity with the subscriber mailbox, spoof a Gmail sender, or automatically send messages during setup.

## Editorial limits of this first release

The live editorial path produces concise attributed source briefings. It verifies that an archived source says something; it does **not** claim independent proof of everything in that source. Model-proposed new factual wording cannot silently replace verified text. A maximum of 25 quoted words per source enters an article. Research gaps remain explicit when the available corpus cannot answer them. Send-back requests enter targeted research and may remain blocked pending additional primary evidence.

There is no licensed results/form data service, private social account access, image-forensics service, autonomous expert outreach, subscription billing or outbound newsletter delivery. These are integration extensions, not simulated live capabilities. The separate form function accepts a researched, sourced shortlist; it does not invent odds or predict guaranteed outcomes. Unverified imagery is omitted. Original email attachments are retained within the private raw message and listed as unverified metadata.

The first source adapters do not bypass logins, paywalls, blocked robots paths or JavaScript-only sites. Read the registry notes before enabling a source. This release handles up to three stories per run, two research rounds, one retry per task and a three-minute engine budget. Modest source volumes suit the single-owner transactional aggregate; archive/partition before scaling to a large newsroom.

Wagering rules are in [`config/wagering-policy.json`](config/wagering-policy.json). The initial policy is explicitly unreviewed and blocks wagering publication. Record current applicable jurisdictions, reviewer and expiry after a competent review; the automated wording filter is not legal clearance.

## Verification

Latest verification: **47/47 tests passed**, and `npm run typecheck` passed. `npm test` covers the full fixture chain, targeted gap closure, independent-origin handling, unpublished approval packages, immutable publications, replay/idempotency, contradictory evidence, false model claims, policy gates, source network restrictions, signed emails, persistent restart, authentication, concurrent run exclusion and paused-AI behaviour. `npm run build` validates the production bundle. See [`docs/architecture.md`](docs/architecture.md) for the evidence flow.

The deployed application, owner access and public endpoint have been checked. Automated fixtures demonstrate the full newsroom loop; they do not establish live AI operation, mailbox forwarding or licensed data access. See [`docs/acceptance.md`](docs/acceptance.md) for the tested boundary and remaining connections.
