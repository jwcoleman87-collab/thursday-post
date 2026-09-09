# Thursday Post — morning startup

The software is deployed. Source collection works now. Paid launch is **not open**: Stripe, authenticated email and live AI still need account setup, and you have not set a price.

## Open the machine

1. Open [the owner newsroom](https://the-racing-desk.vercel.app/newsroom). Your existing password is in the private local `data/OWNER-ACCESS.txt` file.
2. Select **Collect sources**, then **GO · Run newsroom**. This archives permitted source material without AI, email or publication. Racing Queensland is the currently enabled source; this is not national coverage.
3. **Daily monitoring was enabled on 10 September.** The current schedule is 20:00 UTC: 6 am Sydney standard time, 7 am during daylight saving. With AI paused it only collects. Vercel runs this in the cloud; your computer does not need to stay on.
4. Select **Demo mode** to practise research → evidence → editing → approval. Demo material stays private. The **Edit draft, resolve gaps & record reply** link opens the editing desk. Every live article still needs your final approval.

## What still needs your input

- [ ] **Stripe:** sign in to your existing dashboard and complete any business/identity/bank requirements. Connect the app's secret key and signed webhook using `.env.example`; use separate test credentials/data for the trial. The expected event list is `STRIPE_EVENTS` in `src/lib/commerce.ts`. No card payment has yet been exercised against Stripe.
- [ ] **Price and offer:** create one fixed monthly AUD Stripe price. Enter its `price_…` ID in [Operations](https://the-racing-desk.vercel.app/operations). Validation keeps sales closed. Confirm the price, delivery promise and launch date before explicitly opening sales.
- [ ] **Domain and email:** select the publication domain and service budget. Verify the sending domain with Resend and connect member sign-in plus delivery events. Readers reply to **workbenchadmin@gmail.com**; service account identities stay as they are. Configure Gmail forwarding to the separate receiving address if you want automatic tip intake. Saved `.eml` import already works.
- [ ] **AI:** activation is now requested. Vercel's latest access check still returns `403 customer_verification_required`; finish card verification in AI Gateway. Keep paid top-ups off unless a budget is agreed. Then change `NEWSROOM_AI_PAUSED=false`, redeploy and pass `node scripts/verify-live.mjs --run-live`. This requires actual research and PE model usage, evidence and a proposal; HTTP 200 or a successful source fetch alone cannot pass.
- [ ] **Commercial particulars:** confirm your operating business, commercial hosting plan, tax treatment, final terms/privacy and source/image rights. The policy pages are drafts awaiting your business details; a software test cannot complete those decisions. See [ACCC online business guidance](https://www.accc.gov.au/consumers/buying-products-and-services/buying-online) and [OAIC privacy-policy guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-1-app-1-open-and-transparent-management-of-personal-information).
- [ ] **Design:** provide Claude's exact template and approved horse artwork if you want an exact match. The current horse is a new draft of Thursday at his post. Your newer GitHub subscription-only homepage has been preserved.

## Produce and sell the first edition

1. Broaden and review the source list for your promised coverage. Gather real evidence, resolve gaps, edit the reporting and record right-of-reply decisions. Approve only the final article versions. Set deliberate free samples versus member articles.
2. In **Operations**, choose approved articles, order them, set issue number/date/title and review the edition. **Release** and **SEND** are separate actions. Sending requires confirmed paying readers who opted into edition email. Edition pages support printing / the browser's Save as PDF; there is no fixed four-page PDF compositor.
3. Test a real provider-backed customer journey: sign up → confirm email → Stripe test payment → paid access → email → portal/cancel/refund → correct access. Check Gmail and Outlook delivery, then a legitimate live purchase and payout after merchant activation. The current 113 tests use controlled provider responses for these financial/email flows.
4. Invite a consenting pilot group, obtain feedback, complete trial editions and only then open the sales switch. No pilot readers, sample reporting, testimonials or sales have been invented. Track acquisition and retention from actual results; automated visitor attribution and financial payout reconciliation are not connected.

## Where everything is

- [Subscription homepage](https://the-racing-desk.vercel.app) · [Newspaper](https://the-racing-desk.vercel.app/news) · [Editions](https://the-racing-desk.vercel.app/editions)
- [Private GitHub repository](https://github.com/jwcoleman87-collab/thursday-post) · [Claude handoff](CLAUDE_UI_HANDOFF.md)
- [Full launch checklist](LAUNCH_CHECKLIST.md) · [Operations, backup and recovery](OPERATIONS_RUNBOOK.md) · [Verification record](acceptance.md)

The deployed database backup was downloaded privately and restored successfully into a new local SQLite file. Originals are under ignored `data/backups/` and `data/restore-drill/`. Keep those files private. Provider snapshots, scheduled offsite backups, retention automation and remote Postgres recovery remain operational setup work.
