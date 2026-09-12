import assert from "node:assert/strict";
import test from "node:test";
import { BUDGET, createCorrectionStory, createState, decideStory, runNewsroom } from "../src/lib/engine";
import type { ResearchProvider, SourceItem } from "../src/lib/domain";

// In-memory fixtures only: these tests never fetch sources or call a model.
const QUOTE = "The racing authority recorded the revised meeting date";
const LIVE_CAPS = { maxRounds: BUDGET.maxLiveRounds, maxResearchTasks: BUDGET.maxLiveResearchTasks, maxTaskRetries: BUDGET.maxLiveRetries };
const record = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  id: "ordinary-record", title: "Racing welfare update", content: `${QUOTE}.`,
  url: "https://www.racingqueensland.com.au/test-fixtures/ordinary",
  type: "official", sourceName: "Authority test fixture", independenceKey: "authority-fixture",
  publishedAt: "2026-09-11T00:00:00Z", retrievedAt: "2026-09-11T01:00:00Z", region: "QLD", ...overrides,
});
const correction = (id = "reader-correction", overrides: Partial<SourceItem> = {}) => record({
  id, title: `Correction to racing meeting date ${id}`, region: undefined, isCorrection: true,
  url: `https://www.racingqueensland.com.au/test-fixtures/${id}`, ...overrides,
});
function provider() {
  const calls: { storyId: string; agentId: number }[] = [];
  const researcher: ResearchProvider = {
    async research(request) {
      calls.push({ storyId: request.story.id, agentId: request.agentId });
      const source = request.sourceItems.find(item => item.content.includes(QUOTE))!;
      return { findings: [{ text: QUOTE, kind: "record_statement", sourceIds: [source.id], quote: QUOTE, contradictorySourceIds: [], questions: [], confidence: "high" }] };
    },
    async draft(request) {
      const claim = request.story.claims.find(item => item.status === "verified")!;
      return { headline: "Recorded meeting update", sentences: [{ text: claim.text, claimIds: [claim.id] }], researchRequests: [] };
    },
  };
  return { researcher, calls };
}

test("a fresh correction precedes resumed ordinary research; the ordinary story finishes on the next available run", async () => {
  const state = createState();
  const { researcher, calls } = provider();
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, researcher);
  const ordinary = state.stories[0];
  assert.equal(ordinary.status, "blocked");
  const before = calls.length;
  await runNewsroom(state, { mode: "live", items: [correction()], ...LIVE_CAPS }, researcher);
  const revised = state.stories.find(story => story.sourceItems.includes("reader-correction"));
  assert.ok(revised, "The correction must get the sole story slot, not remain in the source backlog");
  assert.equal(revised.status, "waiting_approval");
  assert.equal(ordinary.status, "blocked");
  assert.equal(calls.length - before, BUDGET.maxLiveResearchTasks);
  assert.ok(calls.slice(before).every(call => call.storyId === revised.id));
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, researcher);
  assert.equal(ordinary.status, "waiting_approval");
  assert.deepEqual(calls.filter(call => call.storyId === ordinary.id).map(call => call.agentId).sort(), [...ordinary.researchAgentIds].sort());
  assert.equal(state.publications.length, 0);
});

for (const finalState of ["waiting_approval", "rejected"] as const) {
  test(`an unchanged ${finalState} correction in a repeated feed does not reserve a research slot`, async () => {
    const state = createState();
    const { researcher, calls } = provider();
    await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, researcher);
    const ordinary = state.stories[0];
    const item = correction();
    await runNewsroom(state, { mode: "live", items: [item], ...LIVE_CAPS }, researcher);
    const revised = state.stories.find(story => story.sourceItems.includes(item.id));
    assert.ok(revised);
    if (finalState === "rejected") decideStory(state, revised.id, "reject", "Reject this test package", false);
    const before = calls.length;
    await runNewsroom(state, { mode: "live", items: [item], ...LIVE_CAPS }, researcher);
    assert.equal(ordinary.status, "waiting_approval");
    assert.equal(revised.status, finalState);
    assert.equal(state.stories.length, 2);
    assert.ok(calls.slice(before).every(call => call.storyId === ordinary.id));
    assert.equal(state.publications.length, 0);
  });
}

test("a fresh correction also precedes an ordinary candidate left by an interrupted checkpoint", async () => {
  const state = createState();
  const { researcher, calls } = provider();
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS, deadline: Date.now() - 1 }, researcher);
  const ordinary = state.stories[0];
  ordinary.status = "candidate"; // Shape of the persisted pre-research checkpoint.
  assert.equal(calls.length, 0);
  await runNewsroom(state, { mode: "live", items: [correction()], ...LIVE_CAPS }, researcher);
  const revised = state.stories.find(story => story.sourceItems.includes("reader-correction"));
  assert.ok(revised);
  assert.equal(revised.status, "waiting_approval");
  assert.equal(ordinary.status, "candidate");
  assert.ok(calls.every(call => call.storyId === revised.id));
  assert.equal(state.publications.length, 0);
});

test("a deferred correction retains priority until its required research finishes", async () => {
  const state = createState();
  const { researcher, calls } = provider();
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, researcher);
  const ordinary = state.stories[0];
  await runNewsroom(state, { mode: "live", items: [correction("long-correction", { title: "Correction to racing welfare record", region: "QLD" })], ...LIVE_CAPS }, researcher);
  const revised = state.stories.find(story => story.sourceItems.includes("long-correction"));
  assert.ok(revised);
  assert.equal(revised.status, "blocked");
  const before = calls.length;
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, researcher);
  assert.equal(revised.status, "waiting_approval");
  assert.equal(ordinary.status, "blocked");
  assert.ok(calls.slice(before).every(call => call.storyId === revised.id));
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, researcher);
  assert.equal(ordinary.status, "waiting_approval");
  assert.equal(state.publications.length, 0);
});

test("multiple correction leads respect the live story limit and retained leads are not lost", async () => {
  const state = createState();
  const { researcher, calls } = provider();
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, researcher);
  const ordinary = state.stories[0];
  for (let run = 0; run < 2; run++) {
    const before = calls.length;
    await runNewsroom(state, { mode: "live", items: run === 0 ? [correction("first"), correction("second")] : [], ...LIVE_CAPS }, researcher);
    assert.equal(new Set(calls.slice(before).map(call => call.storyId)).size, BUDGET.maxLiveStories);
    assert.equal(calls.length - before, BUDGET.maxLiveResearchTasks);
    assert.equal(ordinary.status, "blocked");
    assert.equal(state.stories.filter(story => story.status === "waiting_approval").length, run + 1);
  }
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, researcher);
  assert.equal(ordinary.status, "waiting_approval");
  assert.equal(state.stories.length, 3);
  assert.equal(state.publications.length, 0);
});

test("an editor-created correction is prioritised even when its archived sources have no correction flag", async () => {
  const state = createState();
  const { researcher, calls } = provider();
  await runNewsroom(state, { mode: "live", items: [record({ id: "published-record", title: "Racing meeting record", region: undefined })], ...LIVE_CAPS }, researcher);
  decideStory(state, state.stories[0].id, "approve", "Approve in-memory fixture only", false);
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, researcher);
  const ordinary = state.stories.find(story => story.sourceItems.includes("ordinary-record"))!;
  const revised = createCorrectionStory(state, state.publications[0].id, { reason: "Review the recorded meeting date for a correction." });
  assert.equal(state.sourceItems.some(item => item.isCorrection), false);
  const before = calls.length;
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, researcher);
  assert.ok(calls.slice(before).length > 0);
  assert.ok(calls.slice(before).every(call => call.storyId === revised.id));
  assert.equal(ordinary.status, "blocked");
  assert.equal(revised.status, "blocked", "The owner's unresolved correction question still blocks publication");
  assert.equal(state.publications.length, 1, "No correction is published automatically");
});
