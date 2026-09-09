# Acceptance record

## Hosted application

- Live at [the-racing-desk.vercel.app](https://the-racing-desk.vercel.app), in Vercel account `jwcoleman87-collabs-projects`, backed by free Neon Postgres in Sydney.
- Anonymous operator request: **401**. Owner login: **200**. Public endpoint: **200**.
- Reader contact: **workbenchadmin@gmail.com**. Owner credentials remain private in `data/OWNER-ACCESS.txt`.
- No article has been approved for public publication. Demo approvals remain private. Monitoring is paused.
- Final production build succeeded. Hosted verification confirmed the updated contact, live GO safely paused with 503, and demo GO completing with 200 and one draft awaiting James’s approval. Public article count remains zero. The public page and owner sign-in were also checked in the browser.

## Demonstrated newsroom loop

The deterministic demonstration uses fictional Harbour Racing records, clearly labelled `demo`. It needs no external credentials or paid model calls.

| Brief step | Observable implementation |
|---|---|
| Source enters | Fixture source archived with URL, source type, timestamps and provenance. |
| Discovery and selection | Relevant candidate created, deduplicated and routed to multiple research disciplines. |
| Research and Hub | Separate tasks produce structured findings, claims and source evidence. |
| Deliberate gap | Missing primary authority record is identified by the controller. |
| Targeted follow-up | Agent 2 receives the exact missing-record question. The synthetic primary record resolves that gap. |
| PE drafting | Correct editorial desk produces a byline and sentence-to-claim references. |
| Images | Unknown-context demo media is labelled and excluded. |
| Wagering | Dedicated gate checks applicable stories; unreviewed policy blocks them. |
| James gate | Completed package is `waiting_approval`; publication count stays zero. |
| Public boundary | Demo approval creates only a private simulation. Public API stays empty. |
| Trace | Select a passage in the review panel, then follow its Hub claim to research evidence and original source. |

Automated tests also use a controlled non-demo source fixture to exercise the real publication state transition. Those tests run only in temporary storage and never publish externally.

Final verification: **47/47 tests passed** (18 adapter, 21 engine and 8 service tests), and TypeScript checking passed. Coverage includes the fixture chain, persistence, exact-draft approval, policy gates, source restrictions and email ingestion. It also checks that paused AI makes no fetch or mutation, and that Gateway verification failure releases the run lease before source collection. Controlled publication tests use temporary storage and never publish externally. Saved `.eml` import preserves reader leads for research.

## Deliberately pending

James elected to defer live AI activation. Gateway returned **403 `customer_verification_required`**, requiring a card on file. `NEWSROOM_AI_PAUSED=true` is set locally and when deployed: live GO returns 503 without calling the model, while Demo mode remains available. The six research roles and four PE desks are implemented and demonstrated with fixtures; they are not currently running live model research. Resume only after verification, changing the pause setting to `false`, redeploying and testing live GO; enable monitoring afterward.

Automatic forwarding from Gmail is not connected. It requires a dedicated Resend receiving address, API key, webhook signing secret, `NEWSROOM_INBOUND_ADDRESS`, and mailbox forwarding setup. Licensed form/data feeds and current wagering policy review also remain separate integrations. Deployment success does not imply those services are connected.
