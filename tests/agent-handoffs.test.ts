import assert from "node:assert/strict";
import test from "node:test";
import { BUDGET, createState, decideStory, draftHash, runNewsroom } from "../src/lib/engine";
import { createLiveProvider } from "../src/lib/providers";
import type { PeAgentId, SourceItem } from "../src/lib/domain";

const quotations = [
  "The notice was posted.", "Records remain available.", "Veterinary methods were described.",
  "Participant accounts were recorded.", "Image origins are unknown.", "NSW context was stated.",
];
const desks: { pe: PeAgentId; title: string }[] = [
  { pe: 1, title: "Thoroughbred welfare policy consultation" },
  { pe: 2, title: "Thoroughbred welfare stable staff support" },
  { pe: 3, title: "Thoroughbred welfare bloodstock technology study" },
  { pe: 4, title: "International thoroughbred welfare briefing Japan" },
];

function sourceFixture(pe: number, title: string): SourceItem[] {
  const primary: SourceItem = {
    id: `primary-${pe}`, title, content: quotations.join(" "), url: `https://authority.example.org/records/${pe}`,
    type: "official", sourceName: "Fixture Racing Authority", independenceKey: `authority-${pe}`, region: "NSW",
    publishedAt: "2026-09-09T00:00:00Z", retrievedAt: "2026-09-09T01:00:00Z",
    media: [{ id: `image-${pe}`, sourceId: `primary-${pe}`, url: "https://authority.example.org/image.jpg", earliestSource: null,
      proposedCaption: "Unverified fixture image", context: "unknown", date: null, location: null, manipulation: "unknown",
      aiStatus: "unknown", reuseHistory: [], captionSupported: false, rights: "unknown", allowed: false }],
  };
  return [primary, { ...primary, id: `reader-${pe}`, type: "email", sourceName: "Private fixture reader",
    independenceKey: `reader-${pe}`, url: `email:reader-${pe}`, content: "A reader alleges an undisclosed decision.", media: undefined }];
}

function controlledGateway(items: SourceItem[], pe: PeAgentId, failAgent?: number) {
  const events: string[] = [];
  const editorialClaims: string[][] = [];
  const calls: { stage: string; agent?: number }[] = [];
  const provider = createLiveProvider({ apiKey: "test-only-placeholder", model: "fixture/model", transport: async (url, options) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v1/chat/completions");
    const request = JSON.parse(String(options?.body));
    const name = request.response_format.json_schema.name as string;
    const input = JSON.parse(request.messages[1].content);
    let result: unknown;
    if (name === "newsroom_preflight") {
      calls.push({ stage: "preflight" });
      events.push("preflight");
      assert.deepEqual(input, {});
      result = { ok: true };
    } else if (name === "newsroom_research") {
      const agent = Number(/Research Agent (\d)/.exec(request.messages[0].content)?.[1]);
      assert.ok(agent >= 1 && agent <= 6);
      calls.push({ stage: "research", agent });
      events.push(`research:${input.round}:${agent}`);
      if (agent === failAgent) return Response.json({ error: { code: "fixture_unavailable" } }, { status: 503 });
      const primary = input.sources.find((source: { id: string }) => source.id === items[0].id);
      assert.ok(primary.text.includes(quotations[agent - 1]));
      const findings = [{ text: quotations[agent - 1], kind: "record_statement", sourceIds: [primary.id],
        quote: quotations[agent - 1], contradictorySourceIds: [], questions: [], confidence: "high" }];
      if (agent === 4) findings.push({ text: items[1].content, kind: "allegation", sourceIds: [items[1].id],
        quote: items[1].content, contradictorySourceIds: [], questions: [], confidence: "high" });
      result = { findings };
    } else {
      assert.equal(name, "newsroom_editorial");
      assert.match(request.messages[0].content, new RegExp(`PE Agent ${pe} —`));
      calls.push({ stage: "editorial" });
      events.push("editorial");
      editorialClaims.push(input.claims.map((claim: { text: string }) => claim.text));
      assert.ok(input.claims.every((claim: { verificationScope: string }) => claim.verificationScope === "source_statement"));
      assert.ok(!JSON.stringify(input.claims).includes(items[1].content), "Private allegations must not enter verified PE evidence");
      result = { headline: `Desk ${pe} proposed narrative`, sentences: [{ text: "The archived notice is presented for the editor's review.", claimIds: [input.claims[0].id] }], researchRequests: [] };
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  } });
  return { provider, events, editorialClaims, calls };
}

for (const { pe, title } of desks) test(`all six research roles hand off verified evidence to PE ${pe}, then stop for owner review`, async () => {
  const items = sourceFixture(pe, title);
  const originals = structuredClone(items);
  const state = createState();
  const { provider, events, editorialClaims, calls } = controlledGateway(items, pe);
  await provider.preflight();
  await runNewsroom(state, { mode: "live", items }, provider, async snapshot => {
    assert.equal(snapshot.publications.length, 0, "No pipeline checkpoint may publish");
  }, async request => {
    assert.ok(events.includes("editorial"), "PE review must precede its targeted evidence follow-up");
    events.push("retrieval");
    assert.equal(request.maxItems, BUDGET.maxAdditionalSources);
    assert.ok(request.questions.some(question => question.includes(`Image image-${pe}`)));
    return { items: [] };
  });
  assert.deepEqual(items, originals, "Provider requests and processing must not mutate original records");
  assert.equal(state.stories.length, 1);
  const story = state.stories[0];
  assert.deepEqual(story.researchAgentIds, [1, 2, 3, 4, 5, 6]);
  assert.equal(story.peAgentId, pe);
  assert.equal(story.status, "waiting_approval");
  assert.deepEqual(state.tasks.filter(task => task.round === 0).map(task => task.agentId).sort(), [1, 2, 3, 4, 5, 6]);
  assert.ok(state.tasks.every(task => task.status === "completed" && task.attempts === 1));
  const firstEditorial = events.indexOf("editorial");
  for (let agent = 1; agent <= 6; agent++) assert.ok(events.indexOf(`research:0:${agent}`) < firstEditorial);
  assert.ok(events.indexOf("retrieval") > firstEditorial);
  assert.ok(events.indexOf("research:1:5") > events.indexOf("retrieval"));
  assert.ok(events.lastIndexOf("editorial") > events.indexOf("research:1:5"));
  assert.equal(editorialClaims.length, 2);
  for (const quote of quotations) assert.ok(editorialClaims[0].some(text => text.includes(quote)), `PE ${pe} needs evidence from every research role`);
  assert.equal(calls.length, 10, "One preflight, six initial research calls, one targeted call and two PE calls");
  assert.equal(provider.usage.length, calls.length);
  assert.ok(state.runs.filter(run => run.agentType === "editorial").every(run => run.agentId === pe && run.status === "completed"));
  assert.ok(story.findings.some(finding => finding.agentId === 4 && finding.claimIds.some(id => story.claims.find(claim => claim.id === id)?.status === "unverified")));
  assert.equal(story.media[0].allowed, false);
  assert.equal(story.proposedDraft?.status, "requires_human_review");
  assert.equal(story.proposedDraft?.headline, `Desk ${pe} proposed narrative`);
  assert.ok(story.draft?.sentences.length);
  assert.equal(story.draft.hash, draftHash(story.draft));
  assert.equal(story.draft.byline, `Agent ${pe}`);
  assert.ok(!story.draft.body.includes("presented for the editor's review"), "Unreviewed PE paraphrases must remain private proposals");
  for (const sentence of story.draft.sentences) for (const claimId of sentence.claimIds) {
    const claim = story.claims.find(candidate => candidate.id === claimId)!;
    assert.equal(claim.text, sentence.text);
    assert.equal(claim.status, "verified");
    assert.equal(claim.verificationScope, "source_statement");
    assert.ok(claim.evidence.every(evidence => evidence.exactMatch && state.sourceItems.some(source => source.id === evidence.sourceId && source.content.includes(evidence.quote))));
  }
  assert.equal(story.approvals.length, 0);
  assert.equal(state.publications.length, 0);
});

test("one failed researcher propagates a bounded blocking gap despite successful peer and PE work", async () => {
  const { pe, title } = desks[0];
  const items = sourceFixture(pe, title);
  const state = createState();
  const { provider, calls } = controlledGateway(items, pe, 2);
  await provider.preflight();
  await runNewsroom(state, { mode: "live", items }, provider);
  const story = state.stories[0];
  assert.equal(story.status, "blocked");
  const failed = state.tasks.filter(task => task.agentId === 2);
  assert.equal(failed.length, 2, "One initial task and one bounded targeted retry round");
  assert.ok(failed.every(task => task.status === "failed" && task.attempts === BUDGET.retries + 1));
  assert.equal(calls.filter(call => call.agent === 2).length, 4);
  assert.ok(state.tasks.filter(task => task.agentId !== 2).every(task => task.status === "completed"));
  assert.ok(state.runs.some(run => run.agentType === "research" && run.agentId === 2 && run.status === "failed"));
  assert.ok(state.runs.some(run => run.agentType === "editorial" && run.status === "completed"));
  assert.ok(story.proposedDraft?.sentences.length);
  assert.ok(story.gaps.some(gap => gap.agentId === 2 && gap.blocking && gap.status === "open" && gap.question.includes("HTTP 503")));
  assert.equal(story.compliance.find(check => check.gate === "evidence")?.status, "blocked");
  assert.throws(() => decideStory(state, story.id, "approve", "Reviewed", false), /complete package/);
  assert.equal(state.publications.length, 0);
});
