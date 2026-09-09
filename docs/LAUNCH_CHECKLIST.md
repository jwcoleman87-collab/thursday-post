# Thursday Post — checklist to paying subscribers

9 September 2026. Based on the current repository and recorded deployment checks.

The newsroom foundation exists. The paid subscription product does not yet exist. The 47 passing tests cover the present implementation; they do not prove paid launch readiness.

Already built: private GitHub repository; deployed Next.js app; database; owner login; source ingestion framework; evidence/audit records; research/editorial role contracts; demo workflow; human approval controls; public article views; private email-file import.

Still unproven or missing: live AI operation, useful finished editions, subscriber accounts, payments, access control, outbound delivery and customer acquisition. The review also found incomplete revision and correction workflows.

Recommended lean launch to validate: one Thursday edition, email delivery plus a member archive, one monthly plan, and a free sample. If the previously discussed four-page PDF is essential to the offer, include it explicitly; PDF generation is not built. A human-assisted launch is possible before every research function is automated, but the product description must match what is actually delivered.

Owner key: James = decisions, accounts and editorial responsibility; Claude = UI; Build = application/backend work; Specialist = accountant or appropriate legal reviewer. Items may run in parallel where their prerequisites are settled.

- [ ] **1. Pick the first reader — James.** Name one initial audience and coverage area. Write: “Thursday Post helps [reader] understand [specific racing matters] by providing [useful result].” This determines sources, content and promotion.

- [ ] **2. Test the reason to pay — James.** Speak to 10 people in that audience. Show a realistic sample and proposed price. Record what they already read, what is missing and whether they would actually subscribe. Treat these numbers as suggested pilot targets, not forecasts.

- [ ] **3. Lock the offer — James.** Set frequency, release time/timezone, typical content, free versus paid access, archive rights and whether PDF is included. Choose what you can deliver consistently. Do not promise comprehensive national coverage or betting analysis without the inputs to support it.

- [ ] **4. Set price and a spending ceiling — James.** Start with one monthly plan. Budget hosting, AI, email, data rights, payment fees, support and your editorial time. Calculate break-even subscribers as fixed monthly costs divided by contribution per subscriber after applicable taxes, fees and variable costs.

- [ ] **5. Finish the correct branding — Claude + James.** Thursday Post everywhere; Thursday the horse at his post, loose reins, understated silhouette. Finalise an owned/approved logo asset, mobile layouts and “By Agent One” style bylines. Keep backend behaviour intact.

- [ ] **6. Secure the business identity and domain — James.** Check name/trademark conflicts, choose the operating entity, confirm ABN/business-name requirements, bank details and tax treatment. Register the publication domain and connect it to Vercel. Domain availability is still unverified. [Business-name guidance](https://business.gov.au/registrations/register-your-business-name).

- [ ] **7. Confirm commercial hosting — James + Build.** Check the current Vercel plan. If it is Hobby, move to a commercial plan or suitable host before commercial operation. Set usage alerts and decide what happens at the spending ceiling. [Vercel says Hobby is for non-commercial personal use](https://vercel.com/pricing).

- [ ] **8. Activate and test live AI — James + Build.** Complete Gateway account verification when ready, fund an agreed budget, then remove the deliberate pause. Run real sources through research and review. A successful model response alone is not a successful newspaper workflow.

- [ ] **9. Build dependable source coverage — James + Build.** Select and test sources covering the promised geography and subjects. Record access/reuse conditions, source freshness and failure behaviour. Currently Racing Queensland is the enabled source; that is not comprehensive Australian coverage.

- [ ] **10. Finish actual research retrieval — Build.** Agents currently inspect supplied excerpts; follow-up does not reliably fetch missing primary records or independent evidence. Add targeted retrieval and clear human escalation. Improve event-based story deduplication and flag new evidence affecting published reports. Verify it on real stories where the first source is incomplete or wrong.

- [ ] **11. Finish writing and editing — Build + James.** Current output is short attributed source statements with limited headline handling. Add evidence-backed narrative drafting, headline editing, paragraph edits and draft versions. Every substantive edit must invalidate old approval and retain source traceability.

- [ ] **12. Fix Send Back — Build.** Ordinary James/editorial gaps can remain blocked indefinitely because general gap resolution is missing. Add explicit evidence-backed resolution and re-review. Pass a real revise → resolve → new draft → approve test.

- [ ] **13. Add corrections and urgent removal — Build + James.** Provide correction notices, links to revised articles, retractions and audited takedown. Preserve the original privately. Test correcting an already published article and notifying affected readers.

- [ ] **14. Build an actual Thursday edition — Build + Claude.** Add issue date/number, story selection/order, lead story, preview and approved release. Fix public ordering so older articles do not remain the lead. Add PDF export if promised. Prevent duplicate publication or distribution.

- [ ] **15. Resolve content rights and editorial rules — James + Specialist.** Establish permitted quotation, image and data use; allegations/right-of-reply review; conflicts/sponsorship labels; and an accurate AI/editorial disclosure. The code’s 25-word cap is not legal clearance. Keep wagering content blocked until relevant inputs and review exist. [Copyright guidance](https://www.business.qld.gov.au/running-business/risk/ip/types/copyright/infringement).

- [ ] **16. Connect reader correspondence — James + Build.** Keep workbenchadmin@gmail.com as contact/reply address. Configure forwarding to the dedicated receiving address and test a tip, correction, attachment and duplicate delivery. Keep identities/private originals protected and email claims unverified until researched.

- [ ] **17. Build subscriber accounts — Build.** Add reader registration, email verification, login/recovery and account management, separate from James’s owner access. Test that customers cannot open the newsroom, private sources or other customer records.

- [ ] **18. Add real subscription checkout — James + Build.** Set up Stripe business verification/payouts, AUD pricing, recurring product and hosted checkout. Connect signed billing events to stored subscription records. Test successful, declined and authentication-required payments. [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks).

- [ ] **19. Enforce paid access on the server — Build.** The current public API returns full published articles. Protect paid article bodies and archives in routes, API responses and caches; define deliberate free previews. A visual paywall cannot protect content already sent to the browser.

- [ ] **20. Complete the billing lifecycle — Build + James.** Customers need receipts, card updates and self-service cancellation. Handle renewals, failed payments, grace periods, refunds and access expiry. Duplicate or delayed payment events must not grant incorrect access or trigger duplicate actions.

- [ ] **21. Connect authenticated outbound email — James + Build.** Use a verified publication domain for sending, with provider-required DNS authentication and DMARC configured appropriately. Set Reply-To to workbenchadmin@gmail.com. Test Gmail and Outlook delivery. [Resend domain requirements](https://resend.com/docs/dashboard/domains/introduction).

- [ ] **22. Build reliable subscriber delivery — Build.** Add welcome emails, issue delivery, recipient selection, retries, duplicate prevention, bounce/complaint suppression and delivery records. Honour newsletter preferences. Cancelling billing and opting out of marketing must have clearly distinct effects.

- [ ] **23. Finish customer terms and privacy — James + Specialist + Build.** Publish accurate pricing, renewal, cancellation/refund terms, privacy information and contact details. Record marketing consent; identify the sender and honour unsubscribes within required timeframes. Define private-email retention and external AI processing. [ACMA](https://www.acma.gov.au/avoid-sending-spam), [ACCC subscription case](https://www.accc.gov.au/media-release/court-finds-eharmony-engaged-in-misleading-conduct-in-relation-to-automatic-renewal-and-pricing-of-its-subscriptions), [OAIC small-business checklist](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business).

- [ ] **24. Build the sales page — Claude + Build + James.** Explain who it serves, what arrives, when, price and why it is useful. Show a real sample, clear Subscribe button, About/editorial policy, FAQ and support link. Add consent-based free signup, search metadata and working social previews.

- [ ] **25. Make releases recoverable — Build.** Connect the GitHub repository to a controlled deployment workflow. Use preview/staging data and test payment/email settings for changes. Run checks before production, retain rollback instructions and verify Claude’s redesign against existing behaviour.

- [ ] **26. Add operating alerts and cost records — Build.** Persist per-run usage/cost and outcomes. Alert James about failed or missed runs, failed sends, payment webhook problems and overdue approval. Confirm the alert actually arrives; an unnoticed dashboard error is insufficient.

- [ ] **27. Test backup, restore and retention — Build + James.** Verify hosted database recovery settings and restore into a separate environment. Add practical export/archive/delete tools. The inbox currently stops at 1,000 messages without a complete archive tool. Keep secrets in a password manager and define owner-access recovery.

- [ ] **28. Test realistic failures and volume — Build.** Exercise expired login, network interruption, retries, simultaneous actions, unavailable AI/sources, duplicate billing events and inaccessible email. Test the expected pilot load and archive size; the current store serializes one shared aggregate. Add pagination/storage changes when measurements require them.

- [ ] **29. Write the weekly operating routine — James + Build.** Specify collection cutoff, review deadline, approval, release and support checks. Decide what happens when you are unavailable or the model fails. No unattended auto-publication. Ensure another authorised recovery path exists if you lose access.

- [ ] **30. Produce real trial editions — James + Build.** Deliver two consecutive complete editions to an opt-in pilot group; a suggested starting size is 20 readers. Check factual quality, usefulness, reading experience and punctuality. Fix weak content before increasing promotion.

- [ ] **31. Pass the full customer journey — Build + James.** From a fresh device: sample → signup → payment → confirmation → paid access → issue email → renewal → cancellation → correct access expiry/refund. Test nonpayment and private-content isolation too. Verify a legitimate live purchase and payout when the merchant setup is ready.

- [ ] **32. Open a small paid launch — James.** Invite pilot readers who consented to offers to become paying subscribers at the published price. A sensible first target is 25 paying readers. State the first delivery date and founder terms accurately. Do not invent discounts or scarcity.

- [ ] **33. Build an acquisition routine — James.** Share useful sample reporting, seek permission for racing-club/community promotions, arrange relevant partnerships and ask satisfied subscribers for referrals. Track each channel. Avoid purchased lists or unsolicited bulk email; defer substantial ad spend until conversion and retention are visible.

- [ ] **34. Measure whether it is a business — James + Build.** Track visitors → free signups → paid conversions; active paid subscribers; cancellations; refunds; recurring revenue; acquisition spend; delivery failures; total service/editorial costs; and your hours per issue. Reconcile billed revenue with payouts. Decide whether to improve content, change the offer or scale from actual results.

- [ ] **35. Keep earning renewals — James.** Personally collect feedback from early readers, record cancellation reasons, answer support within your stated timeframe and deliver consistently. Repeat purchases/renewals matter more than launch signup totals.

Full original-scope extensions: licensed form/results/markets, dependable expert/social/regional source access, imagery verification services and wider autonomous investigation still require further integrations and validation. Build them before advertising those capabilities; they are not required for an honestly scoped editorial subscription. Native apps, extra agents and elaborate pricing tiers can wait.

Charge only when the promised edition is useful and repeatable, customers can pay/access/cancel reliably, publication and privacy controls work, support is staffed, and the commercial/rights requirements are settled.
