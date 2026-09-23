import assert from "node:assert/strict";
import test from "node:test";
import { createState, runNewsroom, decideStory, resolveStoryGap, editStoryDraft, draftHash, createCorrectionStory, setPublicationStatus, setPublicationAccess, recordRightOfReply } from "../src/lib/engine";
import type { ResearchProvider, SourceItem } from "../src/lib/domain";

const source = (overrides: Partial<SourceItem> = {}): SourceItem => ({ id: "editorial-primary", title: "Thoroughbred track safety consultation", content: "The racing authority opened a track safety consultation. The consultation is open until October.", url: "https://racing.example.org/records/safety", type: "official", sourceName: "Racing Authority", independenceKey: "editorial-authority", publishedAt: "2026-09-09T00:00:00Z", retrievedAt: "2026-09-09T01:00:00Z", region: "NSW", ...overrides });

async function ready() {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [source()] });
  return { state, story: state.stories[0] };
}

test("send back can be closed only by James's evidence-backed resolution and requires a fresh draft decision", async () => {
  const { state, story } = await ready();
  decideStory(state, story.id, "send_back", "Confirm that the safety consultation is open", false);
  await runNewsroom(state, { mode: "live", items: [] });
  const gap = story.gaps.find(item => item.question.includes("James requests"))!;
  assert.equal(gap.status, "open");
  assert.equal(story.status, "blocked");
  const previous = story.draft!.hash;
  const claimIds = [story.claims.find(claim => claim.status === "verified")!.id];
  assert.throws(() => resolveStoryGap(state, story.id, gap.id, { note: "The record answers the question", claimIds: ["invented-claim"], expectedDraftHash: previous }), /verified supporting/);
  assert.equal(gap.status, "open");
  resolveStoryGap(state, story.id, gap.id, { note: "The authority's archived passage explicitly says the consultation opened.", claimIds, expectedDraftHash: previous });
  assert.equal(story.status, "waiting_approval");
  assert.notEqual(story.draft!.hash, previous);
  assert.ok(story.draftHistory?.some(draft => draft.hash === previous));
  assert.ok(state.audit.some(item => item.action === "editorial.gap_resolved"));
  assert.equal(state.publications.length, 0);
  decideStory(state, story.id, "approve", "I reviewed the revised evidence and draft", false);
  assert.equal(state.publications.length, 1);
});

test("owner narrative requires explicit review, valid claim links, version history and current draft fingerprint", async () => {
  const { state, story } = await ready();
  const original = structuredClone(story.draft!);
  const input = { headline: "Authority opens track safety consultation", sentences: [{ text: "A consultation about track safety is open, according to the racing authority.", claimIds: [story.claims[0].id] }], humanReviewed: true, note: "I checked this attributed paraphrase and headline against the original authority passage.", expectedDraftHash: original.hash, label: "analysis" as const, deck: "An attributed briefing from the authority's public record.", access: "public" as const };
  assert.throws(() => editStoryDraft(state, story.id, { ...input, humanReviewed: false }), /explicitly attest/);
  editStoryDraft(state, story.id, input);
  assert.equal(story.draft!.sentences[0].humanReviewed, true);
  assert.equal(story.draft!.factReview!.actor, "James");
  assert.equal(story.draft!.hash, draftHash(story.draft!));
  assert.deepEqual(story.draftHistory![0], original);
  assert.throws(() => editStoryDraft(state, story.id, input), /draft changed/);
  assert.ok(story.claims.every(claim => claim.verificationScope === "source_statement"));
  decideStory(state, story.id, "approve", "Reviewed exact narrative", false);
  assert.equal(state.publications[0].access, "public");
  story.draft!.deck = "Changed after publication";
  assert.equal(state.publications[0].draft.deck, input.deck);
});

test("model narrative and headline remain proposed and cannot attest themselves as human reviewed", async () => {
  const item = source();
  const provider: ResearchProvider = {
    async research() { return { findings: [{ text: "Record", kind: "record_statement", sourceIds: [item.id], quote: "The racing authority opened a track safety consultation.", confidence: "high" }] }; },
    async draft(request) { return { headline: "A racing rule has already changed", sentences: [{ text: "The authority changed the safety rule.", claimIds: [request.story.claims[0].id], humanReviewed: true }] }; },
  };
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [item] }, provider);
  const story = state.stories[0];
  assert.equal(story.proposedDraft?.status, "requires_human_review");
  assert.match(story.proposedDraft!.headline, /already changed/);
  assert.ok(!story.draft!.headline.includes("already changed"));
  assert.ok(!story.draft!.body.includes("changed the safety rule"));
  assert.equal(story.draft!.factReview, undefined);
});

test("correction is a separate reviewed publication and withdrawal retains the original snapshot", async () => {
  const { state, story } = await ready();
  decideStory(state, story.id, "approve", "Reviewed source statement", false);
  const original = state.publications[0];
  const snapshot = structuredClone(original.draft);
  const correction = createCorrectionStory(state, original.id, { reason: "Clarify that consultation is open, rather than an adopted rule." });
  assert.equal(correction.correctionOf, original.id);
  await runNewsroom(state, { mode: "live", items: [] });
  assert.equal(correction.status, "blocked");
  const gap = correction.gaps.find(item => item.question.startsWith("Correction review"))!;
  resolveStoryGap(state, correction.id, gap.id, { note: "The archived record describes a consultation; the correction must preserve that qualification.", claimIds: [correction.claims[0].id], expectedDraftHash: correction.draft!.hash });
  decideStory(state, correction.id, "approve", "Reviewed correction against source", false);
  assert.equal(state.publications[1].correctionOf, original.id);
  assert.equal(state.publications[1].draft.label, "correction");
  setPublicationStatus(state, original.id, { status: "retracted", note: "The original framing needs a visible retraction notice." });
  setPublicationStatus(state, original.id, { status: "removed", note: "Temporarily remove the original while the complaint is reviewed." });
  assert.deepEqual(original.draft, snapshot);
  assert.equal(original.statusHistory!.length, 2);
  assert.equal(original.status, "removed");
  assert.equal(original.public, true);
});

test("adverse tone requires a recorded right-of-reply outcome and does not invent a response", async () => {
  const { state, story } = await ready();
  editStoryDraft(state, story.id, { headline: "Authority opens safety consultation", sentences: story.draft!.sentences, note: "Reviewed evidence and marked adverse tone for editorial review.", humanReviewed: true, expectedDraftHash: story.draft!.hash, editorialTone: "B" });
  assert.equal(story.status, "blocked");
  assert.throws(() => recordRightOfReply(state, story.id, { status: "received", note: "We received a response from the named authority.", recipient: "Authority media office", requestedAt: "2026-09-01T00:00:00Z", sourceIds: [], expectedDraftHash: story.draft!.hash }), /archived evidence/);
  recordRightOfReply(state, story.id, { status: "not_required", note: "This item only attributes a published consultation notice and contains no adverse allegation.", sourceIds: [], expectedDraftHash: story.draft!.hash });
  assert.equal(story.status, "waiting_approval");
  assert.equal(story.rightOfReply!.actor, "James");
});

test("material adverse edits invalidate every completed reply outcome, preserve its audit record and require reconfirmation", async () => {
  for (const status of ["not_required", "received", "declined", "no_response"] as const) {
    const { state, story } = await ready();
    editStoryDraft(state, story.id, { headline: "Authority opens safety consultation", sentences: story.draft!.sentences, note: "Reviewed the evidence and adverse reporting classification.", humanReviewed: true, expectedDraftHash: story.draft!.hash, editorialTone: "B" });
    const reply = { status, note: `The owner reviewed the current reporting and recorded ${status}.`, recipient: "Authority media office", requestedAt: "2026-01-01T00:00:00Z", deadline: "2026-01-02T00:00:00Z", sourceIds: [source().id], expectedDraftHash: story.draft!.hash };
    recordRightOfReply(state, story.id, reply);
    assert.equal(story.status, "waiting_approval");
    const oldRecord = structuredClone(story.rightOfReply!);
    const previousHash = story.draft!.hash;
    editStoryDraft(state, story.id, { headline: story.draft!.headline, sentences: [{ text: "The consultation has a revised focus requiring a fresh response review.", claimIds: [story.claims[0].id] }], note: "James reviewed the revised attributed paragraph against linked evidence.", humanReviewed: true, expectedDraftHash: previousHash });
    assert.equal(story.rightOfReply, undefined, status);
    assert.equal(story.status, "blocked", status);
    assert.throws(() => decideStory(state, story.id, "approve", "Review after material change", false), /waiting for approval|blocked/);
    const audit = state.audit.find(item => item.action === "editorial.right_of_reply_invalidated")!;
    assert.ok(audit.detail.includes(JSON.stringify(oldRecord)), "the complete previous reply decision must remain in the private audit");
    assert.ok(audit.detail.includes(previousHash));
    assert.ok(story.draftHistory!.some(draft => draft.hash === previousHash));
    assert.throws(() => recordRightOfReply(state, story.id, { ...reply, expectedDraftHash: previousHash }), /draft changed/);
    recordRightOfReply(state, story.id, { ...reply, note: "James reconfirmed the prior outcome against the materially revised article.", expectedDraftHash: story.draft!.hash });
    assert.equal(story.status, "waiting_approval");
    decideStory(state, story.id, "approve", "Reviewed the new narrative and reconfirmed reply outcome", false);
    assert.equal(state.publications.length, 1);
  }
});

test("reply outcomes survive formatting, access and review-note edits but not a new adverse classification or changed deck", async () => {
  const { state, story } = await ready();
  editStoryDraft(state, story.id, { headline: "Authority opens safety consultation", sentences: story.draft!.sentences, note: "Reviewed evidence with a neutral reporting classification.", humanReviewed: true, expectedDraftHash: story.draft!.hash, editorialTone: "N" });
  recordRightOfReply(state, story.id, { status: "not_required", note: "The current attributed source summary makes no adverse allegation.", sourceIds: [], expectedDraftHash: story.draft!.hash });
  editStoryDraft(state, story.id, { headline: story.draft!.headline, sentences: story.draft!.sentences, note: "Reclassified the existing report as adverse after editorial review.", humanReviewed: true, expectedDraftHash: story.draft!.hash, editorialTone: "B" });
  assert.equal(story.status, "blocked"); assert.equal(story.rightOfReply, undefined);
  recordRightOfReply(state, story.id, { status: "not_required", note: "James assessed the adverse classification and reconfirmed why no new response is required.", sourceIds: [], expectedDraftHash: story.draft!.hash });
  const confirmed = structuredClone(story.rightOfReply);
  const invalidations = state.audit.filter(item => item.action === "editorial.right_of_reply_invalidated").length;
  editStoryDraft(state, story.id, { headline: `  ${story.draft!.headline}  `, sentences: story.draft!.sentences.map(sentence => ({ ...sentence, text: sentence.text.replace(/ /g, "  ") })), access: "public", note: "Save only whitespace formatting, reader access and the review note.", humanReviewed: true, expectedDraftHash: story.draft!.hash });
  assert.deepEqual(story.rightOfReply, confirmed);
  assert.equal(story.status, "waiting_approval");
  assert.equal(state.audit.filter(item => item.action === "editorial.right_of_reply_invalidated").length, invalidations);
  editStoryDraft(state, story.id, { headline: story.draft!.headline, sentences: story.draft!.sentences, deck: "A materially different framing now requires the authority's response.", note: "James reviewed this new deck against the linked evidence.", humanReviewed: true, expectedDraftHash: story.draft!.hash });
  assert.equal(story.rightOfReply, undefined); assert.equal(story.status, "blocked");
});

test("new evidence cannot carry a completed reply decision into a materially regenerated adverse draft", async () => {
  const { state, story } = await ready();
  editStoryDraft(state, story.id, { headline: "Authority opens safety consultation", sentences: story.draft!.sentences, note: "Reviewed this adverse report before requesting the authority's response.", humanReviewed: true, expectedDraftHash: story.draft!.hash, editorialTone: "B" });
  recordRightOfReply(state, story.id, { status: "not_required", note: "The current source-only briefing contains no adverse allegation requiring a response.", sourceIds: [], expectedDraftHash: story.draft!.hash });
  const approvedReplyDraft = story.draft!.hash;
  await runNewsroom(state, { mode: "live", items: [source({ id: "editorial-new-evidence", content: "The authority has published a revised track safety consultation timetable." })] });
  assert.notEqual(story.draft!.hash, approvedReplyDraft);
  assert.equal(story.rightOfReply, undefined);
  assert.equal(story.status, "blocked");
  assert.ok(story.compliance.some(check => check.gate === "publication" && check.status === "blocked"));
  assert.ok(state.audit.some(item => item.action === "editorial.right_of_reply_invalidated" && item.detail.includes(approvedReplyDraft)));
  assert.throws(() => decideStory(state, story.id, "approve", "Attempt with stale reply outcome", false), /waiting for approval|blocked/);
});

test("new published evidence creates an owner alert without changing the approved snapshot", async () => {
  const { state, story } = await ready();
  decideStory(state, story.id, "approve", "Reviewed record", false);
  const snapshot = structuredClone(state.publications[0]);
  await runNewsroom(state, { mode: "live", items: [source({ id: "updated-record", content: "The track safety consultation has now closed." })] });
  assert.equal(story.publishedEvidenceAlerts?.length, 1);
  assert.deepEqual(state.publications[0], snapshot);
  await runNewsroom(state, { mode: "live", items: [source({ id: "updated-record", content: "The track safety consultation has now closed." })] });
  assert.equal(story.publishedEvidenceAlerts?.length, 1);
});

test("free reading is the publication default while sales are closed and members-only requires an explicit audited action", async () => {
  const { state, story } = await ready();
  decideStory(state, story.id, "approve", "Reviewed record", false);
  const publication = state.publications[0];
  assert.equal(publication.access, "public");
  const snapshot = structuredClone(publication.draft);
  setPublicationAccess(state, publication.id, { access: "members", note: "Move this approved briefing behind the member paywall." });
  assert.equal(publication.access, "members");
  assert.deepEqual(publication.draft, snapshot);
  assert.ok(state.audit.some(item => item.action === "publication.access_changed"));
});

test("human editing cannot bypass quotation limits or wagering review through new text", async () => {
  const { state, story } = await ready();
  const initial = story.draft!.hash;
  const repeated = Array.from({ length: 4 }, () => ({ ...story.draft!.sentences[0] }));
  assert.throws(() => editStoryDraft(state, story.id, { headline: "Authority safety consultation", sentences: repeated, note: "I reviewed the exact source quotations in these paragraphs.", humanReviewed: true, expectedDraftHash: initial }), /quotation budget/);
  assert.equal(story.draft!.hash, initial);
  editStoryDraft(state, story.id, { headline: "Authority safety consultation", sentences: story.draft!.sentences, deck: "This betting analysis requires separate review.", note: "I reviewed the linked source passage and the article metadata.", humanReviewed: true, expectedDraftHash: initial });
  assert.equal(story.wagering, true);
  assert.equal(story.status, "blocked");
  assert.ok(story.compliance.some(check => check.gate === "wagering" && check.status === "blocked"));
});
