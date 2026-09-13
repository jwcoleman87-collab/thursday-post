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

## Delegated scope assessment

When a research agent asks a follow-up question that no assertion in the draft depends on, the
newsroom assessor can record `Additional reporting angle not required for this draft's scope`
instead of leaving the story blocked forever. It is enabled by `NEWSROOM_DELEGATED_SCOPE_ASSESSMENT=true`
(default off) and is deliberately narrow:

- Only a question an agent raised during drafting qualifies. Missing primary records, corrections,
  unfinished research, contradictions and your own send-back requests always stay blocking.
- The draft must consist solely of exact archived quotations. Once you have written narrative prose,
  only you can resolve the question.
- The record names the automated assessor and you as authorising owner separately. It is not a
  verification of the missing evidence and not a human review of the claims, and the original
  question stays open on the record and in the audit trail.
- It is bound to the draft hash and an evidence fingerprint, so any change to the reporting or the
  evidence returns the question to blocking until it is assessed again.
- Withdraw one at any time from the story's evidence questions; the question blocks again immediately.
- Publication, right-of-reply and wagering approval are unchanged and remain yours.

### Attribution, version checks and withdrawal

This release records a delegated assessor's editorial judgement through the existing
owner-authenticated operator session; it does not create a separately authenticated Claude
account or hand an in-app model unrestricted tool access. The endpoint performs structural
checks, not a semantic proof that a question is optional. The authorised assessor must actually
read the draft, the question and the evidence, explain why no assertion depends on that angle,
and link only relevant claims already present in the draft. It must not invoke personal
fact-review or publication approval on James's behalf.

The feature defaults off. After reviewed deployment, a trusted operator can enable
`NEWSROOM_DELEGATED_SCOPE_ASSESSMENT=true` in the existing production environment. This permits
new assessments; it does not retroactively erase existing decisions. The owner can withdraw
an assessment from the editorial desk even when the feature is off.

Before assessment, the authenticated caller reads
`GET /api/editorial?storyId=<story-id>&gapId=<gap-id>` for `expectedDraftHash` and
`expectedEvidenceFingerprint`, then reviews that version. The `scope_assessment` POST must
include both unchanged bindings, a rationale and relevant claim IDs. A stale snapshot, active
research run, disabled delegation or invented actor/verdict field is rejected. Source and
claim contents, not merely their counts, bind the decision. A human-authored headline, deck,
caption or narrative is outside this narrow exact-quotation workflow.

Withdrawal preserves the full decision and its bindings in the audit and records an owner
send-back request, so an already-completed question gets a fresh research revision. The same
assessment cannot immediately be reapplied to the unchanged draft/evidence. It does not mark
the missing evidence verified or publish anything. Owner-page reads hide superseded assessments
without modifying stored history; publication independently rechecks the actual stored state.

Production acceptance: use the actual delegated workflow on a current eligible story, verify
its exact draft appears in `Waiting for you` and `/next-issue` and opens at the editorial review
URL. Do not approve, publish or SEND during verification. Passing automated tests alone is not
this production result.
