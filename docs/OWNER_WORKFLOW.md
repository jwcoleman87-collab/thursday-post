# Running Thursday Post

## Where it stands

The website, private newsroom, evidence hub, editing, approval, edition builder and member/billing/delivery software are built. Automated tests pass, but paid launch is not ready. Card verification and the US$5 monthly AI budget are complete. The first real AI cycle failed exact-quotation checks and then rate limits; live AI is paused for repair. Daily source collection remains enabled. Only Racing Queensland is currently enabled, so this is not national coverage. Stripe is on hold; subscriber email/domain setup and a price are outstanding.

## Your daily sequence

1. **Sign in:** https://the-racing-desk.vercel.app/login. Use the newspaper owner password saved privately in `data/OWNER-ACCESS.txt`, not a service-account password.
2. **Collect:** open `/newsroom`. In the run-mode dropdown select **Collect sources**, then **GO · Run newsroom**. This saves available source records and does not call AI. Settings contains your source roster and Monitoring switch. Daily collection runs in Vercel at 06:00 Sydney standard time / 07:00 daylight time; your computer can be off.
3. **Research, after the live repair passes:** choose **Live sources** and press **GO · Run newsroom**. The controller selects up to three stories, assigns relevant specialists, records evidence, requests bounded follow-up and passes verified claims to the appropriate PE desk. Do not keep pressing GO while it is running. **Demo mode** is fictional practice only.
4. **Monitor:** use Stories, Agents and Evidence hub in the newsroom. `/operations` shows run failures and model usage. A configured connection is not proof of a completed run. A blocked story may need more evidence, provider repair or editorial review.
5. **Proofread and edit:** open a story's review package and **Edit draft, resolve gaps & record reply**. Compare the PE proposal with the original sources and exact supporting passages. Check names, dates, figures, attribution, allegations, missing context and image provenance. The PE proposal is unreviewed copy; saving a human-reviewed draft is your attestation, not a cosmetic checkbox. Every paragraph retains supporting claim IDs. Resolve gaps only with evidence. Adverse reporting needs a right-of-reply decision.
6. **Decide:** use **Send back** with a precise instruction and rerun live research after the repair, or edit/resolve the issue yourself. Owner-requested gaps still need your evidence-backed resolution. **Reject** preserves the research history. **Approve & publish** immediately publishes that exact live article; it is not merely a save button. Articles default to members-only. Make free samples a deliberate access choice.
7. **Prepare an edition:** in `/operations`, choose approved articles, set their order and issue details, preview, then **Release** the edition. **SEND** is separate and requires configured email and eligible consenting subscribers. Sending is not yet operational. `/news` is the reader newspaper; `/editions` is the member archive. Printing/browser Save as PDF exists; a fixed-layout four-page PDF compositor does not.
8. **After publication:** review reader corrections and use the correction/retraction tools; preserve the original record. Reader contact is workbenchadmin@gmail.com. Automatic email intake/forwarding still needs setup; private `.eml` import is available.

## How you direct research

Currently you choose enabled sources and trigger GO; the controller assigns relevant agents automatically. You do not separately chat to ten bots. Specialist roles only run where relevant, and models analyze supplied material rather than browse the whole internet. The current UI has no general "research this topic" commissioning box. Claude's handoff specifically requests that missing feature, with real retrieval and the existing evidence safeguards.

You remain editor and publisher: review the PE writing and source support before approval. Nothing should publish or send simply because an agent finished.
