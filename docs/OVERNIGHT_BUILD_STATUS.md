# Thursday Post overnight launch build

Started 9 September 2026. Branch: codex/launch-build. Production baseline remains ae1e5a1; do not claim new work deployed until verified.

## Authorisation and decisions
- User requested overnight implementation of launch checklist and supplied design brief.
- Configurable monthly plan; LIVE SALES MUST REMAIN CLOSED until James sets price.
- Existing Stripe account may be used. James handles identity/business/bank verification.
- Domain, service budget and live AI activation not confirmed. Existing NEWSROOM_AI_PAUSED=true remains in force. No paid upgrades/domain purchases without these decisions.
- Reader correspondence workbenchadmin@gmail.com. Existing infrastructure account identities stay separate.
- Publication and edition distribution require explicit James approval. No outreach, fabricated subscribers/testimonials or automatic publication.
- Latest design: strong broadsheet, warm off-white/black/charcoal, restrained accent, no rounded-card reader UI. Claude template URL/path requested and pending. Horse Thursday standing at post identity retained; new brief mentions starting/post concept, exact approved artwork not available.

## Parallel ownership
- subscriber_commerce: new members/commerce types/store usage, subscriber auth, Stripe checkout/portal/webhooks/settings, member routes/page and tests.
- launch_gaps: domain/engine/providers/ingestion and editorial/retrieval tests; gap resolution, draft editing, corrections/takedown, bounded missing-source retrieval.
- brand_recall: new editions/delivery types, routes/pages, durable queue/suppression/unsubscribe and tests.
- root: shared durable-store.ts, service/API integration, public/operator design, assets, configuration, infrastructure, docs, final verification/deploy.

## Contracts
- durable-store: readDocument<T>(key,initial), updateDocument<T,R>(key,initial,synchronousMutator), closeDocuments; atomic named document in same durable SQLite/Postgres database.
- Canonical NEWSROOM_PUBLIC_URL, RESEND_FROM_EMAIL, RESEND_API_KEY; separate MEMBER_SESSION_SECRET and DELIVERY_SIGNING_SECRET.
- Members exports currentMember/requireMember(request), hasPaidAccess(member), getDeliveryRecipients(), suppressMember(email,reason).
- Publication new optional status: published/retracted/removed. Immutable original preserved; public/delivery must respect status.

## Verified baseline
- 47 tests passed before launch work; hosted demo stopped for approval, zero public articles.
- GitHub private https://github.com/jwcoleman87-collab/thursday-post; existing live https://the-racing-desk.vercel.app.
- New dependencies/install/tests/deployment in progress; no new result yet.

## Next
1. Complete module implementations and integrate stable contracts.
2. Complete broadsheet + owner operations and accounts UI against design brief/template when supplied.
3. Test all original and new flows, browser desktop/mobile, negative access tests, payment/email mocks then connected sandbox/live configuration as authorised.
4. Push reviewed code, deploy only verified release, keep live sales/AI/email clearly gated where account inputs missing.
5. Record exact working capabilities, outstanding owner actions and evidence; pause overnight follow-up when done.

Overnight heartbeat ID: finish-thursday-post-overnight. Keep quiet when unchanged; report meaningful progress or needed action.
