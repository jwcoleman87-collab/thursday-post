import assert from "node:assert/strict";
import test from "node:test";
import { analyseForm, BUDGET, createState, decideStory, draftHash, routeStory, runNewsroom } from "../src/lib/engine";
import { DEMO_ITEMS, demoResearchProvider } from "../src/lib/fixtures";
import type { ResearchProvider, SourceItem, Story } from "../src/lib/domain";
import { RESEARCH_AGENTS, PE_AGENTS } from "../src/lib/domain";
import { checkWagering, WAGERING_POLICY } from "../src/lib/policy";

const source = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  id: "live-primary-1", title: "Thoroughbred racing authority consultation", content: "The racing authority opened a thoroughbred track safety consultation. No rule change has been adopted.", url: "https://racing.example.org/records/consultation", type: "official", sourceName: "Racing Authority", independenceKey: "racing-authority", publishedAt: "2026-09-09T00:00:00Z", retrievedAt: "2026-09-09T01:00:00Z", region: "NSW", ...overrides,
});

test("full autonomous demo: discover, multiple research roles, primary-record gap, targeted follow-up, draft, stop for James, trace sentence", async () => {
  const state = createState();
  const checkpoints: string[] = [];
  await runNewsroom(state, { mode: "demo", items: DEMO_ITEMS }, undefined, async current => { checkpoints.push(current.stories[0]?.status ?? "empty"); });
  assert.equal(state.stories.length, 1);
  const story = state.stories[0];
  assert.equal(story.status, "waiting_approval");
  assert.equal(state.publications.length, 0);
  assert.equal(story.peAgentId, 1);
  assert.ok(story.researchAgentIds.length >= 2);
  assert.ok(story.gaps.some(g => g.agentId === 2 && g.status === "resolved"));
  assert.ok(state.tasks.some(t => t.agentId === 2 && t.round === 1 && t.status === "completed"));
  assert.ok(state.audit.some(e => e.action === "controller.gap_identified"));
  assert.ok(state.audit.some(e => e.action === "controller.targeted_research"));
  assert.ok(state.audit.some(e => e.action === "controller.gap_resolved"));
  assert.ok(checkpoints.includes("candidate") && checkpoints.includes("researching") && checkpoints.includes("drafting") && checkpoints.includes("waiting_approval"));
  const draft = story.draft!;
  assert.equal(draft.byline, "Agent 1");
  assert.equal(draft.hash, draftHash(draft));
  for (const sentence of draft.sentences) {
    const claim = story.claims.find(c => c.id === sentence.claimIds[0])!;
    assert.equal(claim.status, "verified");
    assert.equal(claim.verificationScope, "source_statement");
    assert.equal(sentence.text, claim.text);
    assert.ok(claim.evidence.some(e => state.sourceItems.some(s => s.id === e.sourceId && s.content.includes(e.quote))));
  }
  assert.ok(story.claims.some(c => c.kind === "allegation" && c.status === "unverified"));
  assert.equal(story.media[0].allowed, false);
  assert.ok(story.draft!.limitations.some(l => l.includes("images have been omitted")));
  assert.ok(!draft.body.includes("reader@example.invalid"));
  const roundtrip = JSON.parse(JSON.stringify(state));
  assert.deepEqual(roundtrip, state);
  decideStory(state, story.id, "approve", "Reviewed the synthetic example", false);
  assert.equal(story.status, "published");
  assert.equal(state.publications[0].public, false);
  assert.equal(state.publications[0].mode, "demo");
  assert.equal(state.publications[0].draftHash, draft.hash);
});

test("live source statement can publish only after approval; snapshot remains unchanged after draft mutation", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [source()] });
  const story = state.stories[0];
  assert.equal(story.status, "waiting_approval");
  assert.equal(state.publications.length, 0);
  assert.match(story.draft!.body, /Racing Authority states:/);
  assert.ok(story.claims.every(c => c.verificationScope !== "underlying_fact"));
  decideStory(state, story.id, "approve", "I reviewed this exact briefing", false);
  assert.equal(state.publications[0].public, true);
  const publishedBody = state.publications[0].draft.body;
  story.draft!.body = "tampered later";
  assert.equal(state.publications[0].draft.body, publishedBody);
  assert.throws(() => decideStory(state, story.id, "approve", "again", false), /final decision/);
});

test("immutable draft hash blocks approval after tampering", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [source()] });
  state.stories[0].draft!.headline = "An unsupported allegation is true";
  assert.throws(() => decideStory(state, state.stories[0].id, "approve", "", false), /Draft changed/);
  assert.equal(state.publications.length, 0);
});

test("idempotent rerun does not duplicate sources, stories, findings, tasks or publications", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "demo", items: DEMO_ITEMS });
  const sizes = [state.sourceItems.length, state.stories.length, state.stories[0].findings.length, state.tasks.length, state.publications.length];
  await runNewsroom(state, { mode: "demo", items: DEMO_ITEMS });
  assert.deepEqual([state.sourceItems.length, state.stories.length, state.stories[0].findings.length, state.tasks.length, state.publications.length], sizes);
});

test("live mode rejects synthetic source evidence", async () => {
  const state = createState();
  await assert.rejects(runNewsroom(state, { mode: "live", items: DEMO_ITEMS }), /Synthetic demo sources/);
  assert.equal(state.publications.length, 0);
});

test("high model confidence, repeated syndication and emailed hearsay cannot verify underlying facts", async () => {
  const state = createState();
  const email = source({ id: "email-1", type: "email", url: "email:123", sourceName: "Reader email", content: "A trainer has secretly been suspended from thoroughbred racing.", independenceKey: "rumour-one" });
  const repeated = source({ id: "social-1", type: "social", url: "https://social.example.org/post", sourceName: "Reposted rumour", content: email.content, independenceKey: "rumour-one" });
  const provider: ResearchProvider = { async research() { return { findings: [{ text: "The trainer was suspended.", kind: "fact", sourceIds: [email.id, repeated.id], quote: email.content, confidence: "high" }] }; } };
  await runNewsroom(state, { mode: "live", items: [email, repeated] }, provider);
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  assert.ok(story.claims.every(c => c.status === "unverified" && c.confidence === "low"));
  assert.equal(story.draft!.sentences.length, 0);
  assert.equal(new Set(story.claims[0].evidence.map(e => e.independenceKey)).size, 1);
  assert.throws(() => decideStory(state, story.id, "approve", "", false), /complete package/);
});

test("invented quotes and provider article sentences are excluded", async () => {
  const state = createState();
  const item = source();
  const provider: ResearchProvider = {
    async research(request) { return { findings: request.agentId === 2 ? [{ text: "Record", kind: "record_statement", sourceIds: [item.id], quote: item.content, confidence: "high" }] : [{ text: "The rule was adopted yesterday.", kind: "record_statement", sourceIds: [item.id], quote: "The rule was adopted yesterday.", confidence: "high" }] }; },
    async draft(request) { return { headline: "Mandatory rule takes effect", sentences: [{ text: "The racing authority adopted the rule yesterday.", claimIds: [request.story.claims.find(c => c.status === "verified")!.id] }] }; },
  };
  await runNewsroom(state, { mode: "live", items: [item] }, provider);
  const story = state.stories[0];
  assert.equal(story.status, "waiting_approval");
  assert.ok(story.claims.some(c => c.status === "unverified"));
  assert.ok(!story.draft!.body.includes("adopted the rule yesterday"));
  assert.ok(!story.draft!.headline.includes("Mandatory"));
  assert.ok(state.audit.some(e => e.action === "editorial.unsupported_draft_rejected"));
});

test("retry budget terminates failed agents with visible unresolved gaps", async () => {
  const state = createState();
  let requests = 0;
  const provider: ResearchProvider = { async research() { requests++; throw new Error("Upstream unavailable"); } };
  await runNewsroom(state, { mode: "live", items: [source()] }, provider);
  assert.equal(state.stories[0].status, "blocked");
  assert.ok(state.tasks.every(t => t.attempts === BUDGET.retries + 1 && t.status === "failed"));
  assert.ok(requests <= 18);
  assert.ok(state.stories[0].gaps.some(g => g.status === "open" && g.question.includes("Upstream unavailable")));
  assert.equal(state.publications.length, 0);
});

test("six research disciplines stay distinct and four PE agents route independently", () => {
  assert.equal(RESEARCH_AGENTS.length, 6);
  assert.equal(PE_AGENTS.length, 4);
  const all = routeStory([source({ content: "International racing authority considers veterinary welfare analysis and bloodstock business technology in Japan.", type: "email", media: DEMO_ITEMS[0].media })]);
  assert.deepEqual(all.researchAgentIds, [1, 2, 3, 4, 5, 6]);
  assert.equal(all.peAgentId, 4);
  assert.equal(routeStory([source({ title: "Thoroughbred sales technology", content: "Bloodstock sales business technology", region: undefined })]).peAgentId, 3);
});

test("send back creates targeted research and preserves instructions as unresolved instead of claiming false closure", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "demo", items: DEMO_ITEMS });
  const story = state.stories[0];
  decideStory(state, story.id, "send_back", "Find whether the consultation applies in Victoria", false);
  assert.equal(story.status, "sent_back");
  await runNewsroom(state, { mode: "demo", items: [] }, demoResearchProvider);
  assert.ok(state.tasks.some(t => t.question.includes("applies in Victoria")));
  assert.ok(story.gaps.some(g => g.question.includes("applies in Victoria") && g.status === "open"));
  assert.equal(story.status, "blocked");
  assert.equal(state.publications.length, 0);
});

test("missing, future or expired wagering review blocks; prohibited wording blocks even reviewed policies", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [source({ title: "Racing wagering policy consultation", content: "The racing authority has opened a wagering policy consultation." })] });
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  assert.equal(checkWagering(story).status, "blocked");
  const validPolicy = { ...WAGERING_POLICY, reviewedAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z", reviewedBy: "Named reviewer" };
  assert.equal(checkWagering(story, validPolicy, new Date("2026-09-09")).status, "passed");
  assert.equal(checkWagering(story, validPolicy, new Date("2026-10-02")).status, "blocked");
  assert.equal(checkWagering(story, validPolicy, new Date("2026-08-31")).status, "blocked");
  const dangerous = structuredClone(story);
  dangerous.title = "A guaranteed winner for kids with a bonus bet";
  const gate = checkWagering(dangerous, validPolicy, new Date("2026-09-09"));
  assert.equal(gate.status, "blocked");
  assert.match(gate.message, /Prohibited|Inducements|minors/);
});

test("story budget limits processing and ignores irrelevant source material", async () => {
  const state = createState();
  const items = Array.from({ length: 6 }, (_, i) => source({ id: `source-${i}`, title: `Racing safety bulletin ${i}`, url: `https://racing.example.org/${i}` }));
  items.push(source({ id: "other", title: "Cooking with carrots", content: "Vegetable soup recipes" }));
  await runNewsroom(state, { mode: "live", items });
  assert.equal(state.stories.length, BUDGET.maxStories);
  assert.ok(state.audit.some(e => e.action === "selection.deferred"));
  assert.ok(state.audit.some(e => e.action === "discovery.out_of_scope"));
});

test("article source quotation totals never exceed 25 words", async () => {
  const state = createState();
  const content = "The thoroughbred racing authority opened a track safety consultation for local race clubs and licensed trainers and invited written feedback from participants throughout the region. Further meetings will occur next week at the racecourse.";
  const item = source({ content });
  const provider: ResearchProvider = { async research() { return { findings: [{ text: "record one", kind: "record_statement", sourceIds: [item.id], quote: content, confidence: "high" }, { text: "record two", kind: "record_statement", sourceIds: [item.id], quote: "Further meetings will occur next week at the racecourse.", confidence: "high" }] }; } };
  await runNewsroom(state, { mode: "live", items: [item] }, provider);
  const story = state.stories[0];
  const total = story.draft!.sentences.flatMap(s => story.claims.filter(c => s.claimIds.includes(c.id))).flatMap(c => c.evidence).reduce((sum, e) => sum + e.quote.split(/\s+/).length, 0);
  assert.ok(total <= 25);
});

test("candidate persisted before interruption can resume", async () => {
  const state = createState();
  let didCrash = false;
  await assert.rejects(runNewsroom(state, { mode: "live", items: [source()] }, undefined, async current => {
    if (!didCrash && current.stories[0]?.status === "candidate") { didCrash = true; throw new Error("Simulated process interruption"); }
  }), /Simulated process/);
  assert.equal(state.stories[0].status, "candidate");
  await runNewsroom(state, { mode: "live", items: [] });
  assert.equal(state.stories[0].status, "waiting_approval");
  assert.equal(state.stories.length, 1);
});

test("form specialist does not invent three selections from missing evidence", () => {
  const result = analyseForm([], []);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.selections, []);
  assert.match(result.limitations.join(" "), /No selections are invented/);
});

test("deferred source backlog is discovered on later GO after records disappear from the feed", async () => {
  const state = createState();
  const items = Array.from({ length: 6 }, (_, index) => source({ id: `backlog-${index}`, title: `Thoroughbred racing bulletin ${index}`, url: `https://racing.example.org/backlog/${index}` }));
  await runNewsroom(state, { mode: "live", items });
  assert.equal(state.stories.length, 3);
  assert.equal(state.sourceItems.length, 6);
  await runNewsroom(state, { mode: "live", items: [] });
  assert.equal(state.stories.length, 6);
  assert.ok(state.stories.every(story => story.status === "waiting_approval"));
  assert.equal(state.publications.length, 0);
});

test("later GO recovers transient failures with a new bounded task budget and retained failed history", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [source()] }, { async research() { throw new Error("Temporary transport outage"); } });
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  const originalFailedTaskIds = state.tasks.filter(t => t.status === "failed").map(t => t.id);
  await runNewsroom(state, { mode: "live", items: [] });
  assert.equal(story.status, "waiting_approval");
  assert.ok(originalFailedTaskIds.every(id => state.tasks.some(t => t.id === id && t.status === "failed" && t.attempts === 2)));
  assert.ok(state.tasks.every(t => t.attempts <= BUDGET.retries + 1));
  assert.ok(state.audit.some(event => event.action === "research.retry_scheduled"));
  assert.ok(state.audit.some(event => event.action === "controller.operation_recovered"));
  assert.ok(story.gaps.filter(gap => gap.question.includes("Temporary transport outage")).every(gap => gap.status === "resolved"));
  assert.equal(state.publications.length, 0);
});

test("recovering a provider does not falsely resolve still-missing primary evidence", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [source({ type: "publication" })] }, { async research() { throw new Error("Temporary outage"); } });
  await runNewsroom(state, { mode: "live", items: [] });
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  assert.ok(story.gaps.some(gap => gap.question.startsWith("Locate the primary") && gap.status === "open"));
  assert.ok(story.gaps.filter(gap => gap.question.includes("Temporary outage")).every(gap => gap.status === "resolved"));
});

test("new primary evidence reopens blocked story and closes only the primary-record gap", async () => {
  const state = createState();
  const lead = source({ id: "publication-lead", type: "publication", url: "https://publication.example.org/story" });
  await runNewsroom(state, { mode: "live", items: [lead] });
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  await runNewsroom(state, { mode: "live", items: [source()] });
  assert.equal(state.stories.length, 1);
  assert.equal(story.status, "waiting_approval");
  assert.ok(story.sourceItems.includes("live-primary-1"));
  assert.ok(story.gaps.some(gap => gap.status === "resolved" && gap.question.startsWith("Locate the primary")));
});

test("already processed inbox history does not consume the new-source ingestion budget", async () => {
  const state = createState();
  const old = Array.from({ length: 60 }, (_, index) => source({ id: `old-${index}`, title: `Unrelated vegetable recipe ${index}`, content: "A recipe for vegetable soup", url: `https://example.org/recipe/${index}` }));
  await runNewsroom(state, { mode: "live", items: old });
  assert.equal(state.stories.length, 0);
  const newest = source({ id: "newest-reader-tip", type: "email", url: "email:newest", title: "Correction to thoroughbred racing coverage" });
  await runNewsroom(state, { mode: "live", items: [...old, newest] });
  assert.ok(state.sourceItems.some(item => item.id === newest.id));
  assert.equal(state.stories.length, 1);
});

test("persistent deferred demo sources are excluded from a later live discovery run", async () => {
  const state = createState();
  const synthetic = Array.from({ length: 4 }, (_, index) => source({ id: `synthetic-${index}`, title: `Synthetic racing record ${index}`, demo: true, url: `https://example.invalid/demo/${index}` }));
  await runNewsroom(state, { mode: "demo", items: synthetic }, { async research() { return { findings: [] }; } });
  assert.equal(state.sourceItems.length, 4);
  assert.equal(state.stories.length, 3);
  await runNewsroom(state, { mode: "live", items: [source()] });
  const live = state.stories.filter(story => story.mode === "live");
  assert.equal(live.length, 1);
  assert.equal(live[0].status, "waiting_approval");
  assert.deepEqual(live[0].sourceItems, ["live-primary-1"]);
});
