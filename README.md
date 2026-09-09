# Thursday Post

An Australian thoroughbred publication with a private editorial workspace, evidence-linked reporting, dated editions and member access. Thursday is the horse standing at his post. The current mark and newspaper layout are drafts: James's exact reference artwork and Claude template have not been supplied. Start UI work with [the Claude handoff](docs/CLAUDE_UI_HANDOFF.md) and [design brief](docs/DESIGN_PRODUCT_BRIEF.md).

## Current status — 10 September 2026

**106/106 automated tests passed; TypeScript passed.** The current production build, browser checks and deployment verification are pending. Earlier hosted checks do not establish that this expanded implementation is deployed or ready for paying customers.

The existing [hosted project](https://the-racing-desk.vercel.app), repository identity and infrastructure names remain unchanged. Its configured infrastructure is Vercel and Sydney Neon Postgres; local work uses SQLite.

Live AI remains paused after AI Gateway required account verification. Source-only collection works independently of the AI pause. Stripe and live Resend services are not connected; sales are closed and the subscription price is unset. Automatic Gmail forwarding is unconnected. Reader correspondence remains **workbenchadmin@gmail.com**. No new live customer charge, email campaign or public publication has been verified during this build.

## Local use

Requires Node.js 22.13 or later; development and CI use Node 24.

```powershell
npm ci
npm run setup
npm test
npm run typecheck
npm run build
npm start
```

The server binds to loopback. Open the [reader front page](http://127.0.0.1:3000/) or [owner newsroom](http://127.0.0.1:3000/newsroom). Setup creates initial local credentials without overwriting existing configuration. `LOCAL_DEMO_ACCESS=true` is restricted to local loopback access and disabled on Vercel; use `/login` to exercise owner authentication.

| Route | Purpose |
|---|---|
| `/`, `/news`, `/news/[id]` | Front page, newspaper alias and stories |
| `/newsroom` | Research, collection, evidence, inbox and approval |
| `/editorial/[id]` | Narrative editing, gap resolution and right of reply |
| `/operations` | Billing, edition release/SEND, health and backup |
| `/editions`, `/editions/[id]` | Edition archive and member-aware reader |
| `/subscribe`, `/member` | Offer, signup/sign-in, account and preferences |
| `/corrections`, `/post-box`, `/about`, `/contact`, `/privacy`, `/terms` | Reader information and publication policies |

## Implemented

- Six research disciplines, four editorial desks and public bylines **By Agent 1–4**. Bounded RSS/HTML collection and targeted retrieval preserve originals, apply robots/origin/DNS restrictions and record failures. Saved `.eml` imports and signed inbound-mail handling retain private originals.
- Claims distinguish source statements from independently proven facts. Models propose prose and headlines; James must attest an evidence-linked edit before it replaces the safe quotation draft. Gap resolution, draft history, stale-hash rejection, internal A/B/N tone and right-of-reply records support review. **B means adverse/dubious** and requires a recorded reply outcome or rationale.
- Approval, rejection and send-back remain explicit. Corrections create linked stories; withdrawals preserve original snapshots. Later evidence affecting a publication creates an owner audit alert. Demo publications remain private.
- New live articles default to members; free samples require an owner action. Member sign-in, server-side access, Stripe checkout/portal/webhook reconciliation, delivery preferences and suppression handling are implemented, awaiting live configuration.
- Dated, numbered editions contain ordered article snapshots and review hashes. Release and SEND are separate actions. Delivery rechecks eligibility/withdrawals, uses bounded retries/idempotency and processes signed events. Email unsubscribe does not cancel billing.
- Durable run records, usage reporting, optional rate-based estimates, private backups and isolated restore tools are available. See [operations and recovery](docs/OPERATIONS_RUNBOOK.md).

## Configuration and boundaries

Use [.env.example](.env.example); keep secrets in private deployment settings or ignored local configuration. `DATABASE_URL` is required on Vercel. AI needs verified model access and `NEWSROOM_AI_PAUSED=false`; collection needs enabled, reviewed sources. Member sign-in requires its session secret and verified sending setup. Billing additionally needs Stripe keys/webhooks and an owner-validated monthly AUD price. Resend inbound and delivery webhooks use separate secrets; Gmail forwarding is a separate mailbox action.

The daily cron processes only delivery jobs previously authorized by SEND, even when monitoring is paused. Enabled monitoring selects collection-only mode while AI is paused; otherwise it runs research. Cron never creates campaigns, approves articles or automatically sends owner alerts.

Research is bounded to three stories, two rounds and registered sources. Licensed form/results feeds, private social access, expert outreach and media forensics remain unconnected extensions. Unknown imagery is withheld. Wagering review remains a publication gate; automated checks are not legal clearance. Public policy pages need publisher review before sales open.

Local data and backups contain private evidence and member records. Do not commit or share them. Export through the owner endpoint or documented CLI; restore only into a new isolated target.

[Acceptance](docs/acceptance.md) separates fixture coverage from live verification. [Architecture](docs/architecture.md) records backend contracts. GitHub CI now defines install, typecheck, tests and production build; its hosted execution has not been verified for this candidate.
