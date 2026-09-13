import assert from "node:assert/strict";
import test from "node:test";
import { clearScopeAssessment, createState, decideStory, editStoryDraft, recordScopeAssessment, runNewsroom, SCOPE_ASSESSMENT_OUTCOME, scopeAssessmentContext, projectScopeAssessments } from "../src/lib/engine";
import type { DraftResult, ResearchProvider, SourceItem, Story } from "../src/lib/domain";

// In-memory fixtures only: these tests never fetch sources or call a model.
const QUOTE = "The racing authority recorded the revised meeting date";
const ANGLE = "Can you provide more details about the owners and stable staff for a fuller profile?";
const CAPS = { maxRounds: 1, maxTaskRetries: 0 } as const;

const record = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  id: "scope-record", title: "Racing welfare update", content: `${QUOTE}.`,
  url: "https://www.racingqueensland.com.au/test-fixtures/scope",
  type: "official", sourceName: "Authority test fixture", independenceKey: "authority-fixture",
  publishedAt: "2026-09-11T00:00:00Z", retrievedAt: "2026-09-11T01:00:00Z", region: "QLD", ...overrides,
});

function provider(researchRequests: DraftResult["researchRequests"] = [{ agentId: 6, question: ANGLE }]) {
  const researcher: ResearchProvider = {
    async research(request) {
      const source = request.sourceItems.find(item => item.content.includes(QUOTE))!;
      return { findings: [{ text: QUOTE, kind: "record_statement", sourceIds: [source.id], quote: QUOTE, contradictorySourceIds: [], questions: [], confidence: "high" }] };
    },
    async draft(request) {
      const claim = request.story.claims.find(item => item.status === "verified")!;
      return { headline: "Recorded meeting update", sentences: [{ text: claim.text, claimIds: [claim.id] }], researchRequests };
    },
  };
  return researcher;
}

/** A blocked live story whose only open blocking question is an agent's extra-colour follow-up. */
async function blockedOnAngle(overrides: Partial<SourceItem> = {}) {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [record(overrides)], ...CAPS }, provider());
  const story = state.stories[0];
  const gap = story.gaps.find(item => item.question === ANGLE)!;
  return { state, story, gap };
}

const rationale = "The draft quotes only the authority's recorded meeting date; it makes no claim about owners or stable staff, so the angle supports no assertion in this draft.";
const linkedClaims = (story: Story) => [story.claims.find(claim => claim.status === "verified")!.id];

test("an agent's extra-colour angle can be scoped out, leaving the question on the record and the evidence unverified", async () => {
  const { state, story, gap } = await blockedOnAngle();
  assert.equal(story.status, "blocked");
  assert.ok(gap.blocking && gap.status === "open");
  const hashBefore = story.draft!.hash;

  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: hashBefore }, true);

  assert.equal(story.status, "waiting_approval");
  // The decision is not a resolution, not a verification and not a human review.
  assert.equal(gap.status, "open");
  assert.equal(gap.question, ANGLE);
  assert.equal(gap.resolution, undefined);
  assert.equal(story.draft!.factReview, undefined);
  assert.equal(story.draft!.hash, hashBefore, "a scope assessment must not rewrite the reviewed draft");
  // The automated assessor is recorded separately from the authorising owner.
  assert.equal(gap.scopeAssessment!.assessor, "newsroom-assessor");
  assert.equal(gap.scopeAssessment!.authorisingOwner, "James");
  assert.equal(gap.scopeAssessment!.outcome, "not_required_for_scope");
  assert.equal(gap.scopeAssessment!.rationale, rationale);
  // The original question survives in the audit trail, attributed to the assessor.
  const entry = state.audit.find(item => item.action === "editorial.scope_assessed")!;
  assert.ok(entry.detail.includes(ANGLE));
  assert.ok(entry.detail.includes(SCOPE_ASSESSMENT_OUTCOME));
  assert.ok(entry.detail.includes("Newsroom assessor"));
  assert.ok(!/James reviewed|James resolved/.test(entry.detail));
  assert.ok(state.audit.every(item => item.action !== "editorial.gap_resolved"));
  // Passing the gate is visible and honest, and publication is still James's.
  assert.match(state.stories[0].compliance.find(check => check.gate === "evidence")!.message, /not required for this draft's scope/);
  assert.equal(state.publications.length, 0);
});

test("an unauthorised request is refused server-side and changes nothing", async () => {
  const { state, story, gap } = await blockedOnAngle();
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, false), /not enabled/);
  assert.equal(gap.scopeAssessment, undefined);
  assert.equal(story.status, "blocked");
  assert.ok(state.audit.every(item => item.action !== "editorial.scope_assessed"));
});

test("genuine blockers cannot be scoped out", async () => {
  // A missing primary record is real missing evidence, not an optional angle.
  const publication = await blockedOnAngle({ type: "publication" });
  const primary = publication.story.gaps.find(item => item.question.startsWith("Locate the primary racing authority"))!;
  assert.ok(primary.blocking && primary.status === "open");
  assert.throws(() => recordScopeAssessment(publication.state, publication.story.id, primary.id, { ...scopeAssessmentContext(publication.state, publication.story.id, primary.id), rationale, claimIds: linkedClaims(publication.story), expectedDraftHash: publication.story.draft!.hash }, true), /Only an additional reporting angle/);
  assert.equal(publication.story.status, "blocked");

  // James's own send-back instruction is not an agent angle either.
  const { state, story, gap } = await blockedOnAngle();
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, true);
  decideStory(state, story.id, "send_back", "Check the meeting date against the stewards' report", false);
  const owner = story.gaps.find(item => item.question.startsWith("James requests"))!;
  assert.throws(() => recordScopeAssessment(state, story.id, owner.id, { ...scopeAssessmentContext(state, story.id, owner.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, true), /Only an additional reporting angle/);
  assert.equal(story.status, "sent_back");
  assert.equal(state.publications.length, 0);
});

test("a scoped-out angle needs a real rationale and verified claims from this story", async () => {
  const { state, story, gap } = await blockedOnAngle();
  const hash = story.draft!.hash;
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale: "too short", claimIds: linkedClaims(story), expectedDraftHash: hash }, true), /specific rationale/);
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: ["invented-claim"], expectedDraftHash: hash }, true), /specific rationale/);
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: "stale-hash" }, true), /draft changed/);
  assert.equal(gap.scopeAssessment, undefined);
  assert.equal(story.status, "blocked");
});

test("changed reporting invalidates the assessment and returns the question to blocking", async () => {
  const { state, story, gap } = await blockedOnAngle();
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, true);
  assert.equal(story.status, "waiting_approval");

  const claim = story.claims.find(item => item.status === "verified")!;
  editStoryDraft(state, story.id, { headline: "Authority records a revised meeting date", sentences: [{ text: claim.text, claimIds: [claim.id] }], humanReviewed: true, note: "I checked the headline and paragraph against the archived authority passage.", expectedDraftHash: story.draft!.hash });

  assert.equal(gap.scopeAssessment, undefined);
  assert.ok(state.audit.some(entry => entry.action === "editorial.scope_assessment_superseded"));
  assert.equal(story.status, "blocked", "a rewritten draft must be reassessed before the angle is out of scope again");
  assert.match(story.compliance.find(check => check.gate === "evidence")!.message, /1 blocking question/);

  // Human-authored headline/deck are outside this narrow automated delegation.
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: [claim.id], expectedDraftHash: story.draft!.hash }, true), /exact archived quotations/);
  assert.equal(story.status, "blocked");
  assert.equal(state.publications.length, 0);
});

test("right-of-reply and publication approval are unaffected by a scope assessment", async () => {
  const { state, story, gap } = await blockedOnAngle();
  const claim = story.claims.find(item => item.status === "verified")!;
  // Fixture isolates the publication gate without introducing a human-written draft.
  story.editorialTone = "B";
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: [claim.id], expectedDraftHash: story.draft!.hash }, true);

  assert.equal(state.stories[0].compliance.find(check => check.gate === "evidence")!.status, "passed");
  assert.equal(state.stories[0].compliance.find(check => check.gate === "publication")!.status, "blocked");
  assert.equal(story.status, "blocked", "adverse reporting still needs James's right-of-reply outcome");
  assert.equal(state.publications.length, 0);
});

test("new evidence on the story invalidates the assessment even when the draft is unchanged", async () => {
  const { state, story, gap } = await blockedOnAngle();
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, true);
  const before = gap.scopeAssessment!.evidenceFingerprint;
  const hash = story.draft!.hash;

  // An unverified allegation drawn from the already-archived source: no new source id, no new
  // verified claim and no draft change — but material bearing on the very question scoped out.
  story.claims.push({ id: "claim-latearrival", text: "An unverified allegation about the stable's ownership.", kind: "allegation", agentId: 6, evidence: [], status: "unverified", verificationScope: "unverified", confidence: "low", questions: ["Who owns the stable?"], createdAt: new Date().toISOString() });

  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: hash }, true);
  assert.equal(story.draft!.hash, hash, "the draft itself is unchanged, so only the evidence binding can catch this");
  assert.notEqual(gap.scopeAssessment!.evidenceFingerprint, before, "new claim material must move the evidence fingerprint and invalidate the earlier assessment");
});

test("a story James sent back keeps that status when an unrelated angle is scoped out", async () => {
  const { state, story, gap } = await blockedOnAngle();
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, true);
  assert.equal(story.status, "waiting_approval");
  decideStory(state, story.id, "send_back", "Check the meeting date against the stewards' report", false);
  assert.equal(story.status, "sent_back");

  // Re-recording the same angle against the current draft must not strand the send-back:
  // a blocked story whose only open gaps are non-operational is never requeued for research.
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, true);
  assert.equal(story.status, "sent_back", "James's send-back must survive a delegated scope assessment");
  assert.equal(state.publications.length, 0);
});

test("James can withdraw a delegated assessment and the question blocks again", async () => {
  const { state, story, gap } = await blockedOnAngle();
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story), expectedDraftHash: story.draft!.hash }, true);
  assert.equal(story.status, "waiting_approval");

  clearScopeAssessment(state, story.id, gap.id, { note: "I want this angle reported before it runs.", expectedDraftHash: story.draft!.hash });
  assert.equal(gap.scopeAssessment, undefined);
  assert.equal(gap.status, "open");
  assert.equal(story.status, "sent_back");
  assert.ok(state.audit.some(item => item.action === "editorial.scope_assessment_withdrawn"));
  assert.throws(() => clearScopeAssessment(state, story.id, gap.id, { note: "Nothing left to withdraw.", expectedDraftHash: story.draft!.hash }), /no delegated scope assessment/);
});

test("a human-written narrative cannot have an angle scoped out, and smuggled fields are ignored", async () => {
  const { state, story, gap } = await blockedOnAngle();
  const claim = story.claims.find(item => item.status === "verified")!;
  // James's own prose can assert things no quotation carries, so the assessor must step back.
  editStoryDraft(state, story.id, { headline: "Authority records a revised meeting date", sentences: [{ text: "The stable will race at the rescheduled meeting, with staffing arrangements unchanged.", claimIds: [claim.id] }], humanReviewed: true, note: "I checked this attributed paraphrase against the archived authority passage.", expectedDraftHash: story.draft!.hash });
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: [claim.id], expectedDraftHash: story.draft!.hash }, true), /exact archived quotations/);
  assert.equal(story.status, "blocked");

  // A caller cannot name its own actor or verdict: the engine reads only the three inputs.
  const clean = await blockedOnAngle();
  const smuggled = { ...scopeAssessmentContext(clean.state, clean.story.id, clean.gap.id), rationale, claimIds: linkedClaims(clean.story), expectedDraftHash: clean.story.draft!.hash, assessor: "James", authorisingOwner: "attacker", outcome: "verified" } as unknown as Parameters<typeof recordScopeAssessment>[3];
  recordScopeAssessment(clean.state, clean.story.id, clean.gap.id, smuggled, true);
  assert.equal(clean.gap.scopeAssessment!.assessor, "newsroom-assessor");
  assert.equal(clean.gap.scopeAssessment!.authorisingOwner, "James");
  assert.equal(clean.gap.scopeAssessment!.outcome, "not_required_for_scope");
});

test("a changed evidence snapshot cannot be silently accepted under an unchanged draft hash", async () => {
  const { state, story, gap } = await blockedOnAngle();
  const prepared = { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story) };
  story.claims[0].questions = ["New material requiring assessment"];
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, prepared, true), /Evidence changed/);
  assert.equal(gap.scopeAssessment, undefined);
  assert.equal(story.status, "blocked");
});

test("same-count source or claim edits invalidate displayed scope decisions without mutating storage", async () => {
  for (const change of [
    (state: ReturnType<typeof createState>, story: Story) => { state.sourceItems[0].content += " New stable staffing information."; },
    (_state: ReturnType<typeof createState>, story: Story) => { story.claims[0].questions = ["One question"]; },
    (_state: ReturnType<typeof createState>, story: Story) => { story.claims[0].evidence[0].relation = "contradicts"; },
  ]) {
    const { state, story, gap } = await blockedOnAngle();
    recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story) }, true);
    change(state, story);
    const persisted = JSON.stringify(state);
    const view = projectScopeAssessments(state);
    assert.equal(view.stories[0].gaps.find(g => g.id === gap.id)!.scopeAssessment, undefined);
    assert.equal(view.stories[0].status, "blocked");
    assert.equal(JSON.stringify(state), persisted, "a read-only projection cannot persist statuses or audit events");
    assert.deepEqual(view.audit, state.audit);
    assert.throws(() => decideStory(state, story.id, "approve", "Cannot approve stale assessment", false), /blocked/);
    assert.equal(state.publications.length, 0);
  }
});

test("a human-written headline alone cannot be ruled out by a delegated assessor", async () => {
  const { state, story, gap } = await blockedOnAngle();
  const claim = story.claims[0];
  editStoryDraft(state, story.id, { headline: "Stable staff welfare unchanged as meeting moves", deck: "Staffing remains unchanged", sentences: [{ text: claim.text, claimIds: [claim.id] }], humanReviewed: true, note: "Fixture owner narrative; this is not a production attestation.", expectedDraftHash: story.draft!.hash });
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: [claim.id] }, true), /exact archived quotations/);
  assert.equal(gap.scopeAssessment, undefined);
});

test("withdrawal preserves the full assessment, blocks replay and grants a fresh research revision", async () => {
  const { state, story, gap } = await blockedOnAngle();
  // Fixture models an editorial question whose own task has already finished.
  story.status = "sent_back";
  await runNewsroom(state, { mode: "live", items: [], ...CAPS }, provider());
  const previous = state.tasks.filter(task => task.question === ANGLE && task.status === "completed");
  assert.equal(previous.length, 1);
  recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story) }, true);
  const assessment = structuredClone(gap.scopeAssessment!);
  clearScopeAssessment(state, story.id, gap.id, { note: "Please report this angle before the article runs.", expectedDraftHash: story.draft!.hash });
  assert.equal(story.status, "sent_back");
  const withdrawal = JSON.parse(state.audit.find(entry => entry.action === "editorial.scope_assessment_withdrawn")!.detail);
  assert.deepEqual(withdrawal.assessment, assessment);
  assert.equal(withdrawal.gapId, gap.id);
  assert.throws(() => recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story) }, true), /withdrew/);
  let calls = 0;
  const researcher = provider();
  await runNewsroom(state, { mode: "live", items: [], ...CAPS, maxResearchTasks: 2 }, { ...researcher, async research(request) { if (request.question === ANGLE) calls++; return researcher.research(request); } });
  assert.equal(calls, 1, "withdrawal cannot reuse the already-completed task as new research");
  assert.equal(state.tasks.filter(task => task.question === ANGLE && task.status === "completed").length, 2);
  assert.equal(gap.status, "open", "finishing a task does not invent the missing evidence");
  assert.equal(state.publications.length, 0);
});

test("wagering and disputed claims stay blocked under delegated scope assessment", async () => {
  const wager = await blockedOnAngle();
  wager.story.wagering = true;
  recordScopeAssessment(wager.state, wager.story.id, wager.gap.id, { ...scopeAssessmentContext(wager.state, wager.story.id, wager.gap.id), rationale, claimIds: linkedClaims(wager.story) }, true);
  assert.equal(wager.story.compliance.find(check => check.gate === "wagering")!.status, "blocked");
  assert.equal(wager.story.status, "blocked");
  const disputed = await blockedOnAngle();
  disputed.story.claims.push({ ...structuredClone(disputed.story.claims[0]), id: "disputed-other", status: "disputed" });
  assert.throws(() => recordScopeAssessment(disputed.state, disputed.story.id, disputed.gap.id, { ...scopeAssessmentContext(disputed.state, disputed.story.id, disputed.gap.id), rationale, claimIds: linkedClaims(disputed.story) }, true), /Contradictory evidence/);
});


test("reassessment archives the complete previous decision before replacing stale or current bindings", async () => {
  for (const evidenceChanged of [true, false]) {
    const { state, story, gap } = await blockedOnAngle();
    recordScopeAssessment(state, story.id, gap.id, { ...scopeAssessmentContext(state, story.id, gap.id), rationale, claimIds: linkedClaims(story) }, true);
    const original = structuredClone(gap.scopeAssessment!);
    if (evidenceChanged) story.claims[0].questions.push("Additional context requiring the assessor to reread the evidence");
    const fresh = scopeAssessmentContext(state, story.id, gap.id);
    const replacementRationale = rationale + " Reassessed against the current archived snapshot.";
    const before = state.audit.length;
    recordScopeAssessment(state, story.id, gap.id, { ...fresh, rationale: replacementRationale, claimIds: linkedClaims(story) }, true);
    const events = state.audit.slice(before);
    const superseded = events.filter(entry => entry.action === "editorial.scope_assessment_superseded");
    assert.equal(superseded.length, 1, "the previous decision needs exactly one structured archival event");
    const archived = JSON.parse(superseded[0].detail);
    assert.equal(archived.gapId, gap.id);
    assert.equal(archived.question, gap.question);
    assert.deepEqual(archived.assessment, original, "original rationale, actors, claims and bindings must survive");
    assert.ok(events.indexOf(superseded[0]) < events.findIndex(entry => entry.action === "editorial.scope_assessed"));
    assert.equal(gap.scopeAssessment!.rationale, replacementRationale);
    assert.equal(gap.scopeAssessment!.evidenceFingerprint, fresh.expectedEvidenceFingerprint);
    assert.equal(gap.scopeAssessment!.draftHash, original.draftHash);
    if (evidenceChanged) assert.notEqual(gap.scopeAssessment!.evidenceFingerprint, original.evidenceFingerprint);
    assert.equal(story.status, "waiting_approval");
    assert.equal(gap.status, "open");
    assert.equal(gap.resolution, undefined);
    assert.equal(state.publications.length, 0);
  }
});
