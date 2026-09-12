import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { BUDGET, createState, decideStory, runNewsroom } from "../src/lib/engine";
import type { DraftRequest, DraftResult, NewsroomState, ResearchProvider, ResearchRequest, ResearchResult, SourceItem, Story } from "../src/lib/domain";

/**
 * Regression for the observed production failure: research succeeded, but the live request
 * allowance was exhausted before every assigned discipline had run. The remaining agents were
 * deferred, the story was left blocked, and the next run commissioned a brand-new lead instead
 * of returning to it — so the blocked backlog grew daily and the approval tray stayed empty.
 *
 * Deferred research still blocks approval, by design. What must hold is that a later run
 * finishes it: deferrals are resumed ahead of fresh leads, completed work is never repeated,
 * each deferral clears as its agent reports, and the story then reaches waiting_approval.
 */

const QUOTE = "The stewards recorded a veterinary withdrawal before the fourth race";

const record = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  id: "budget-primary-1", title: "Stewards report on race four withdrawal",
  content: `${QUOTE}. No penalty was imposed and the club described the decision as routine.`,
  url: "https://www.racingqueensland.com.au/stewards/race-four", type: "official",
  sourceName: "Racing Queensland", independenceKey: "racing-queensland",
  publishedAt: "2026-09-11T00:00:00Z", retrievedAt: "2026-09-11T01:00:00Z", region: "QLD", ...overrides,
});

/** The exact live limits src/lib/service.ts passes to runNewsroom. */
const LIVE_CAPS = { maxRounds: BUDGET.maxLiveRounds, maxResearchTasks: BUDGET.maxLiveResearchTasks, maxTaskRetries: BUDGET.maxLiveRetries } as const;

function provider(options: { failResearch?: boolean } = {}): ResearchProvider & { researchCalls: number[] } {
  const researchCalls: number[] = [];
  return {
    researchCalls,
    async research(request: ResearchRequest): Promise<ResearchResult> {
      researchCalls.push(request.agentId);
      if (options.failResearch) throw new Error("AI Gateway is rate limited. Wait before starting another live run.");
      const source = request.sourceItems.find(item => item.content.includes(QUOTE))!;
      return { findings: [{ text: `${source.sourceName} states: “${QUOTE}”`, kind: "record_statement", sourceIds: [source.id], quote: QUOTE, contradictorySourceIds: [], questions: [], confidence: "high" }] };
    },
    async draft(request: DraftRequest): Promise<DraftResult> {
      const claim = request.story.claims.find(c => c.status === "verified");
      if (!claim) return { headline: "Unsupported", sentences: [], researchRequests: [] };
      return { headline: "Stewards record veterinary withdrawal", sentences: [{ text: claim.text, claimIds: [claim.id] }], researchRequests: [] };
    },
  };
}

const deferrals = (story: Story) => story.gaps.filter(gap => gap.status === "open" && gap.id === `gap-${createHash("sha256").update(`${story.id}|provider-budget-agent-${gap.agentId}`).digest("hex").slice(0, 20)}`);
/** Mirrors src/components/newsroom.tsx: the "Waiting for you" metric. */
const waitingForYou = (state: NewsroomState) => state.stories.filter(story => story.status === "waiting_approval");
/** Mirrors src/components/next-issue-preview.tsx: the private /next-issue proof. */
const nextIssueProof = (state: NewsroomState) => state.stories.filter(story => story.mode === "live" && story.draft && ["waiting_approval", "published"].includes(story.status));

test("research exhausts the live allowance, later runs resume it ahead of fresh leads, and the story reaches approval without repeating work", async () => {
  const state = createState();
  const research = provider();

  // 1. Research succeeds, but only BUDGET.maxLiveResearchTasks agents fit in one run.
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, research);
  const story = state.stories[0];
  assert.equal(state.stories.length, 1);
  assert.equal(research.researchCalls.length, BUDGET.maxLiveResearchTasks, "The live allowance caps research at maxLiveResearchTasks per run");
  const deferredAfterFirstRun = deferrals(story).length;
  assert.equal(deferredAfterFirstRun, story.researchAgentIds.length - BUDGET.maxLiveResearchTasks, "Every agent that did not fit is recorded as deferred");
  assert.equal(story.status, "blocked", "Deferred research still blocks: it must be finished, not bypassed");
  assert.equal(waitingForYou(state).length, 0);

  // 2. Later runs each offer a fresh lead. The unfinished story must come first.
  let runs = 1;
  const progress = [deferredAfterFirstRun];
  while (state.stories[0].status === "blocked" && runs < 10) {
    runs += 1;
    const lead = record({ id: `budget-new-lead-${runs}`, title: `Separate racing lead ${runs}`, url: `https://www.racingqueensland.com.au/news/lead-${runs}` });
    await runNewsroom(state, { mode: "live", items: [lead], ...LIVE_CAPS }, research);
    assert.equal(state.stories.length, 1, `Run ${runs} must resume the unfinished story, not commission a fresh lead`);
    progress.push(deferrals(story).length);
  }
  assert.ok(state.audit.some(entry => entry.action === "selection.resumed"), "Resuming unfinished research is recorded");
  assert.ok(state.audit.some(entry => entry.action === "selection.deferred"), "Holding a fresh lead for a later run is recorded");

  // 3. Deferrals clear as their work completes, and the story reaches the approval gate.
  assert.deepEqual(progress, [...progress].sort((a, b) => b - a), `Deferrals must clear monotonically, saw ${progress.join(" → ")}`);
  assert.equal(progress.at(-1), 0, "No deferral may remain once the story is out of blocked");
  assert.equal(story.status, "waiting_approval");
  assert.equal(runs, Math.ceil(story.researchAgentIds.length / BUDGET.maxLiveResearchTasks), "Runs needed is agents divided by the per-run allowance");

  // Completed work is never researched twice.
  assert.deepEqual([...research.researchCalls].sort(), [...story.researchAgentIds].sort(), "Each assigned agent researches exactly once across all runs");

  // The approval-ready story is the one both owner surfaces read.
  assert.deepEqual(waitingForYou(state).map(s => s.id), [story.id], "Story appears in the newsroom \"Waiting for you\" metric");
  assert.deepEqual(nextIssueProof(state).map(s => s.id), [story.id], "Story appears in the private /next-issue proof");
  assert.ok(story.draft, "The proof renders story.draft, so a draft must exist");
  // next-issue-preview.tsx links to /editorial/<id>; the id must survive that round trip.
  assert.equal(decodeURIComponent(encodeURIComponent(story.id)), story.id);
  assert.equal(state.publications.length, 0, "Nothing publishes automatically");

  // 4. A retained lead is processed once capacity frees up: leads are held, not lost.
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, research);
  assert.equal(state.stories.length, 2, "A lead deferred during the backlog must still be picked up later");
  const followUp = state.stories.find(s => s.id !== story.id)!;
  assert.ok(followUp.sourceItems.some(id => id.startsWith("budget-new-lead-")), "The new story is built from a preserved backlog lead");
});

test("unresolved evidence still blocks approval and cannot be published", async () => {
  const state = createState();
  // Every agent fails, so no claim is verified and no draft can be supported.
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, provider({ failResearch: true }));
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  assert.equal(story.compliance.find(check => check.gate === "evidence")!.status, "blocked");
  assert.equal(waitingForYou(state).length, 0);
  assert.equal(nextIssueProof(state).length, 0);
  assert.throws(() => decideStory(state, story.id, "approve", "Trying to publish unverified work", false), /waiting for approval|blocked/);
  assert.equal(state.publications.length, 0);
});

test("a run exhausted before research starts must not skip assigned disciplines on recovery", async () => {
  const state = createState();
  const research = provider();
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS, deadline: Date.now() - 1 }, research);
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  assert.deepEqual(research.researchCalls, []);
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, research);
  assert.equal(story.status, "blocked", "The first recovery run cannot approve a four-discipline story after running only the timeout gap's agent");
  assert.equal(research.researchCalls.length, BUDGET.maxLiveResearchTasks);
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, research);
  assert.equal(story.status, "waiting_approval");
  assert.deepEqual([...research.researchCalls].sort(), [...story.researchAgentIds].sort());
  assert.equal(state.publications.length, 0);
});

test("fresh evidence reopens previously resolved research deferrals until that version is complete", async () => {
  const state = createState();
  const research = provider();
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, research);
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, research);
  const story = state.stories[0];
  assert.equal(story.status, "waiting_approval");
  const completedBefore = research.researchCalls.length;
  await runNewsroom(state, { mode: "live", items: [record({ id: "updated-authority-record", url: "https://www.racingqueensland.com.au/stewards/race-four-update" })], ...LIVE_CAPS }, research);
  assert.equal(story.status, "blocked", "Resolved deferrals from the old source version must not hide unfinished research on the new version");
  assert.equal(deferrals(story).length, story.researchAgentIds.length - BUDGET.maxLiveResearchTasks);
  assert.throws(() => decideStory(state, story.id, "approve", "Cannot approve an unfinished revised evidence package", false), /waiting for approval|blocked/);
  await runNewsroom(state, { mode: "live", items: [], ...LIVE_CAPS }, research);
  assert.equal(story.status, "waiting_approval");
  assert.deepEqual(research.researchCalls.slice(completedBefore).sort(), [...story.researchAgentIds].sort());
  assert.equal(state.publications.length, 0);
});

test("all six assigned disciplines finish across three bounded runs", async () => {
  const state = createState();
  const research = provider();
  const primary = record({ media: [{ id: "budget-image", url: "https://www.racingqueensland.com.au/image.jpg", sourceId: "budget-primary-1", earliestSource: null, proposedCaption: "Unverified image", context: "unknown", date: null, location: null, manipulation: "unknown", aiStatus: "unknown", reuseHistory: [], captionSupported: false, rights: "unknown", allowed: false }] });
  const social = record({ id: "budget-social", type: "social", url: "https://www.racingqueensland.com.au/public-notice" });
  for (let run = 1; run <= 3; run++) {
    const before = research.researchCalls.length;
    await runNewsroom(state, { mode: "live", items: run === 1 ? [primary, social] : [], ...LIVE_CAPS }, research);
    assert.equal(research.researchCalls.length - before, BUDGET.maxLiveResearchTasks);
    assert.equal(state.stories[0].status, run < 3 ? "blocked" : "waiting_approval");
    assert.equal(state.publications.length, 0);
  }
  assert.deepEqual(state.stories[0].researchAgentIds, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...research.researchCalls].sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(deferrals(state.stories[0]).length, 0);
  assert.equal(state.stories[0].media[0].allowed, false, "Completing an imagery task does not clear image rights or authenticity");
});

test("an editorial evidence gap remains blocking even when it uses operational-deferral wording", async () => {
  const state = createState();
  const research = provider();
  const draft = research.draft!;
  const question = "Research Agent 2 is queued for the next live run; confirm a conflicting account before publication.";
  research.draft = async request => ({ ...await draft(request), researchRequests: [{ agentId: 2, question }] });
  for (let run = 0; run < 3; run++) {
    await runNewsroom(state, { mode: "live", items: run === 0 ? [record()] : [], ...LIVE_CAPS }, research);
  }
  const story = state.stories[0];
  assert.ok(story.claims.some(claim => claim.status === "verified"), "This control includes genuinely supported draft material");
  assert.equal(deferrals(story).length, 0);
  assert.ok(story.gaps.some(gap => gap.question === question && gap.status === "open" && gap.blocking));
  assert.equal(story.status, "blocked");
  assert.throws(() => decideStory(state, story.id, "approve", "Unresolved editorial question remains", false), /waiting for approval|blocked/);
  assert.equal(state.publications.length, 0);
});

test("failed provider attempts stay archived while healthy later runs finish the story", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [record()], ...LIVE_CAPS }, provider({ failResearch: true }));
  const failedIds = state.tasks.filter(task => task.status === "failed").map(task => task.id);
  assert.equal(failedIds.length, BUDGET.maxLiveResearchTasks);
  const research = provider();
  for (let run = 0; run < 4 && state.stories[0].status === "blocked"; run++) {
    await runNewsroom(state, { mode: "live", items: [record({ id: `recovery-lead-${run}`, title: `New racing lead ${run}`, url: `https://www.racingqueensland.com.au/news/recovery-${run}` })], ...LIVE_CAPS }, research);
    assert.equal(state.stories.length, 1);
  }
  const story = state.stories[0];
  assert.equal(story.status, "waiting_approval");
  assert.deepEqual(research.researchCalls.slice().sort(), story.researchAgentIds.slice().sort());
  assert.ok(failedIds.every(id => state.tasks.some(task => task.id === id && task.status === "failed")));
  assert.ok(state.audit.some(entry => entry.action === "research.retry_scheduled"));
  assert.equal(story.gaps.filter(gap => gap.status === "open" && gap.blocking).length, 0);
  assert.equal(state.publications.length, 0);
});
