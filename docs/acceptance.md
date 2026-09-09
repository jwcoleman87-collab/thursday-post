# Acceptance record — 10 September 2026

**Current repository: 107/107 automated tests passed; TypeScript and production builds passed.** The expanded application is deployed. Desktop/mobile checks found no application errors or page-wide overflow; subscription, newspaper, member, archive, owner operations and draft-review navigation were checked.

The existing [Vercel project](https://the-racing-desk.vercel.app), repository identity and Sydney Neon configuration are unchanged. `/` preserves the incoming subscription landing design with real signup/sales status; `/news` is the newspaper. Owners work at `/newsroom`. No new production publication, customer charge or outbound campaign has been verified during this build.

## Automated evidence

Tests use temporary databases, synthetic records and controlled provider transports. They do not establish live account readiness.

| Area | Verified implementation boundary |
|---|---|
| Research | Six disciplines/four desks, explicit gaps, source tracing, retry/deadline limits, source revisions and demo isolation |
| Collection | Source-only operation with paused AI, bounded registered retrieval, access/network restrictions and later consumption of collected backlog |
| Editorial | Human-attested narrative, verified claim links, history, stale hashes, send-back resolution and B-tone right-of-reply gating |
| Publication | Exact snapshots, linked corrections, audited withdrawal, member defaults and explicit free samples |
| Members/billing | Sign-in/session boundaries, server-side access, checkout/portal settings and webhook reconciliation under fixture transports |
| Editions/delivery | Edition snapshots, separate release/SEND, eligibility, suppression, withdrawal checks, retries and replay protection |
| Operations | Durable run/usage records, lease recovery, safe errors, monitoring gaps and explicit owner-alert transport |
| Recovery | Private export, integrity checks, populated newsroom/document round-trip, CLI restore and refusal to overwrite source/existing targets |
| Scheduler/auth | Protected owner actions, same-origin checks, paused-AI nonmutation and authorized-queue processing while monitoring is paused |

GitHub CI now defines install, typecheck, tests and production build. A workflow file is not evidence that a hosted run completed.

## Live connections and release work pending

- AI Gateway previously required account verification; live AI remains paused. Source-only collection needs no model, but enabled sources still require actual access/terms review and successful live fetches.
- Stripe and live Resend are unconnected. Sales are closed; the monthly AUD price is unset. Verify test-mode and then live checkout, webhooks, member sign-in, account management and refund/cancellation behavior before admitting paying customers.
- Gmail forwarding needs a dedicated receiving address and mailbox configuration. Inbound, delivery-event and Stripe signatures use their respective secrets. `.eml` import remains available.
- Public policy copy, wagering review, licensed data and imagery rights need publisher reviews/integrations. Automated checks are not legal or rights clearance.
- The exact Claude template and approved horse artwork are missing. The layout and mark remain drafts.
- Release, SEND and sales activation remain explicit. Real provider-backed customer sign-in, payments and email delivery still require their connections and end-to-end validation.

Hosted checks on 10 September (Sydney): anonymous owner APIs and checkout returned 401; owner login returned 200; anonymous member status contained no member; live research returned the intentional paused 503; private demo and real collection returned 200. Two live source records remain archived, two new run records completed, no active lease remained, monitoring stayed paused, sales remained closed and public article count stayed zero. No model request, customer charge or outbound email was made.

The authenticated hosted backup returned 200 with private/no-store caching and restored into a newly created local SQLite file with matching data and integrity checks. Confidential backup and restore files remain under ignored `data/`. Remote Postgres restore, offsite schedules and provider snapshot arrangements remain unverified. See [operations and recovery](OPERATIONS_RUNBOOK.md).
