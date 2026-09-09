# Thursday Post — checklist to paying subscribers

10 September 2026. Start with [Morning startup](MORNING_START.md).

**Verified:** 107 tests, TypeScript, local/Vercel builds and hosted owner/access/demo/collection checks passed. Two live records were archived; a hosted backup restored into new SQLite with integrity verified. No live sales, public articles or outbound emails.

Software is built; sales remain closed. Stripe login, authenticated email/domain, price and AI/budget decisions are pending. Checked items mean software complete, not live-provider or business approval.

- [ ] **1. Pick the first reader — James.** Name the initial audience, geography and useful outcome. Turn that into one sentence guiding coverage, source selection and promotion.

- [ ] **2. Test willingness to pay — James.** Show realistic reporting and a proposed price to prospective readers. Ten conversations is a suggested pilot target; record actual responses, not assumed demand.

- [ ] **3. Lock the offer — James.** Confirm Thursday release time/timezone, content, archive access and free samples. Printing/Save as PDF works; a fixed four-page PDF compositor is not built.

- [ ] **4. Set price and budget — James.** Choose one monthly AUD plan and ceilings for AI, hosting, email, licensed data and support. Calculate contribution and break-even using actual fees/tax advice.

- [ ] **5. Finalise branding — James + Claude.** Thursday Post and numbered “By Agent 1–4” bylines are implemented. Supply the exact template and approved Thursday-at-his-post artwork; current layout/mark remain drafts.

- [ ] **6. Confirm business and domain — James.** Settle entity, name/trademark checks, banking, tax treatment and publication domain. Connect the chosen domain after confirming ownership. [Business-name guidance](https://business.gov.au/registrations/register-your-business-name).

- [ ] **7. Confirm commercial hosting — James.** Verify the hosting plan permits commercial operation, set usage alerts and decide what happens at the spending ceiling. Successful deployment does not settle this. [Vercel pricing](https://vercel.com/pricing).

- [ ] **8. Activate live AI — James + Build.** Complete Gateway verification, agree funding/limits, remove the pause and review real end-to-end research. Source-only collection already works without activating AI.

- [ ] **9. Broaden dependable coverage — James.** Racing Queensland collection passed, with two archived records. Add reviewed sources matching the promised coverage; verify freshness, permitted reuse and failure handling. This is not national coverage.

- [ ] **10. Validate research retrieval — Build + James.** Bounded registered-source retrieval and published-evidence alerts are built. Test genuinely incomplete/conflicting real stories; improve title-based event matching where it misses relationships.

- [x] **11. Writing and editing software — Complete.** Headline/narrative proposals, human-attested edits, claim references, draft history and stale-approval rejection are implemented. Model prose cannot approve itself; editorial quality still needs real trials.

- [x] **12. Send Back completion — Complete.** James can resolve a question with verified supporting claims and a recorded explanation. Resolution refreshes the draft/hash; the tested revise-to-approval path preserves explicit review.

- [x] **13. Corrections and withdrawal software — Complete.** Linked corrections, visible notices, retractions and audited removal retain original snapshots. Test the reader communication procedure during the pilot; no correction email has been sent live.

- [x] **14. Edition workflow — Complete.** Dated, numbered, ordered editions support preview, review hashes and distinct release/SEND actions. Public ordering is corrected. Any promised fixed-layout PDF remains a separate scope decision.

- [ ] **15. Approve rights/editorial rules — James + Specialist.** Review quotation, imagery, data, sponsorship and AI disclosures. B-tone adverse reporting has a right-of-reply gate. Wagering remains review-gated; code is not clearance. [Copyright guidance](https://www.business.qld.gov.au/running-business/risk/ip/types/copyright/infringement).

- [ ] **16. Connect correspondence — James + Build.** Keep workbenchadmin@gmail.com for readers. Configure dedicated receiving and Gmail forwarding; test real tips, corrections, attachments and duplicate deliveries. Private `.eml` import already works.

- [ ] **17. Verify subscriber accounts live — Build + James.** Registration/sign-in, verified email links, sessions and account preferences are built separately from owner access. Connect email and test real delivery/recovery and customer isolation.

- [ ] **18. Activate subscription checkout — James + Build.** Checkout and signed-event handling are built. Sign into Stripe, finish merchant/payout requirements, validate a monthly AUD price, then exercise payment success/failure/authentication. [Stripe events](https://docs.stripe.com/billing/subscriptions/webhooks).

- [x] **19. Server-side paid access — Complete.** Paid bodies/sources are withheld from unauthorized article and edition responses. Free previews/samples are deliberate owner choices; customer access is not enforced merely by visual locks.

- [ ] **20. Verify the billing lifecycle — Build + James.** Portal and renewal/failure/refund/dispute reconciliation are implemented and fixture-tested. Verify actual receipts, card changes, cancellation, renewal and expiry/refund behavior with Stripe.

- [ ] **21. Authenticate outbound email — James + Build.** Choose the domain, configure required DNS authentication and sending identity, retain the reader reply address, and check Gmail/Outlook delivery. [Resend domains](https://resend.com/docs/dashboard/domains/introduction).

- [ ] **22. Prove subscriber delivery — Build + James.** Edition queues, eligibility, retries, deduplication, suppression and signed events are built. Confirm real delivery and onboarding messages; email unsubscribe and billing cancellation remain distinct.

- [ ] **23. Finalise terms/privacy — James + Specialist.** Draft pages and consent/preferences exist. Supply business details; review pricing, renewals, refunds, retention and external processing. [ACMA](https://www.acma.gov.au/avoid-sending-spam), [ACCC subscription guidance](https://www.accc.gov.au/media-release/court-finds-eharmony-engaged-in-misleading-conduct-in-relation-to-automatic-renewal-and-pricing-of-its-subscriptions), [OAIC](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business).

- [x] **24. Sales-page software — Complete.** The latest GitHub subscription layout is preserved at `/`; the newspaper is `/news`. Signup readiness, account routes and metadata exist. Real price, samples and promises await owner decisions.

- [ ] **25. Rehearse recoverable releases — Build.** GitHub CI checks and successful local/Vercel builds exist. Establish isolated provider test settings, record rollback steps and rehearse recovery before billing customers; retain backend contracts through redesigns.

- [ ] **26. Finish operating escalation — Build + James.** Run records, token estimates, dashboard warnings and an explicit owner-alert action are built. Connect actual alerts and define escalation for failed sends/webhooks and overdue approvals.

- [ ] **27. Complete backup/retention operations — Build + James.** Hosted export and isolated SQLite restore passed. Remote Postgres restore, provider snapshots and offsite schedules remain untested; define retention/archive/delete and owner-access recovery.

- [ ] **28. Test pilot load and failures — Build.** Automated tests cover substantial auth, replay, concurrency and provider failures. Measure realistic archive/traffic loads and recovery times; partition/paginate the shared aggregate when measurements require it.

- [ ] **29. Set the weekly routine — James.** Use [Morning startup](MORNING_START.md) and the [operations runbook](OPERATIONS_RUNBOOK.md). Assign cutoff, review, release, SEND, support and absence/recovery responsibilities. There is no unattended article approval.

- [ ] **30. Produce trial editions — James.** Complete two consecutive real editions for an opt-in pilot group. Twenty readers is only a suggested starting target. Validate usefulness, accuracy and punctuality before broader promotion.

- [ ] **31. Pass the customer journey — Build + James.** Verify signup, confirmation, Stripe test payment, access, issue email, renewal, cancellation and refund. Then check a legitimate live purchase/payout after activation. Provider-backed tests remain pending.

- [ ] **32. Open a small paid launch — James.** Invite consenting pilot readers at the published price and delivery date. Twenty-five paying readers is an optional target, not a forecast. Open sales explicitly after prerequisites pass.

- [ ] **33. Start acquisition — James.** Share useful samples, seek permission for community partnerships and encourage referrals. Marketing has not been performed. Track actual channels; do not invent testimonials or use purchased mailing lists.

- [ ] **34. Measure business results — James + Build.** Track signup/conversion, paid readers, churn, refunds, revenue, costs and editorial hours. Visitor attribution and payout reconciliation are not connected; reconcile against actual provider records.

- [ ] **35. Earn renewals — James.** Gather feedback and cancellation reasons, meet stated support times and deliver consistently. Renewals and reader usefulness—not an initial signup count—determine whether to expand.

Licensed form/results, expert outreach, private social sources, media forensics and wider autonomous investigation remain extensions. Advertise only capabilities and coverage actually supplied. Keep sales closed until the promised edition, provider-backed customer journey, support and commercial/rights decisions are ready.
