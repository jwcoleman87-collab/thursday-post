# Finish a readable article without a false personal review

This operator workflow does not grant the in-app model tools, publication authority or automatic semantic verification. An authorised assessor must read the actual archived sources, current draft, dates and every proposed sentence.

Enable `NEWSROOM_DELEGATED_DRAFT_REVIEW=true` in the existing Production environment and redeploy the reviewed revision. This is separate from the narrower scope-assessment flag.

In the owner-authenticated browser, GET `/api/editorial?action=assessed_draft&storyId=<id>` for current draft/evidence bindings and the effective feature setting. POST `/api/editorial` with `action: "assessed_draft"`, `storyId`, those two bindings, `headline: {text, evidence: [{sourceId, quote}]}`, `paragraphs: [{text, evidence: [{sourceId, quote}]}]`, and a specific `note` explaining source, attribution, quote and date checks. Exact passages must exist in a public archived source on this story, at most 25 words each. Existing direct-quotation allowance applies to article text, not paragraph length; write original prose, not 25-word fragments.

No actor, verdict, humanReviewed, authority, access or status fields are accepted. The server records the newsroom assessor separately from James as authorising owner. Old personal reviews and drafts are retained intact; the new version is not a relabelled human review. Complete all required reporting; this endpoint does not clear evidence gaps.

Where an agent-raised optional angle genuinely supports no assertion in the new article, use the existing version-bound `scope_assessment` action AFTER saving and rereading the new draft/evidence. Never classify necessary evidence as optional. Human edits, changed evidence, disputes, incomplete research, owner send-backs and legal/reply controls are not waived.

Verify the full saved draft and review link on the owner pages. No GO call is needed solely to save a checked draft or assess an optional angle. Do not approve, publish or SEND during this verification. For Wild Monarch, do not present the pre-13-September preview as an upcoming race or invent a result.
