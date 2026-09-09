import assert from "node:assert/strict";
import test from "node:test";
import { createState, runNewsroom } from "../src/lib/engine";
import { createTargetedRetriever, type RegisteredSource, type safeFetchText } from "../src/lib/ingestion";
import type { SourceItem } from "../src/lib/domain";

const lead: SourceItem = { id: "retrieval-lead", title: "Thoroughbred track safety consultation", content: "A racing publication reports a track safety consultation.", url: "https://publication.example.org/story", type: "publication", sourceName: "Racing Publication", independenceKey: "publication", publishedAt: "2026-09-09T00:00:00Z", retrievedAt: "2026-09-09T01:00:00Z" };
const registry: RegisteredSource[] = [{ id: "official", name: "Racing Authority", url: "https://authority.example.org/feed/", allowedHosts: ["authority.example.org"], format: "rss", type: "official", region: "NSW", enabled: true, termsReviewedAt: "2026-01-01T00:00:00Z", notes: "Fixture registration" }];

test("targeted retrieval fetches new relevant registered evidence with remaining deadline and resolves a missing primary record", async () => {
  const requests: { url: string; timeoutMs?: number }[] = [];
  const fetchText: typeof safeFetchText = async (url, hosts, options = {}) => {
    requests.push({ url, timeoutMs: options.timeoutMs });
    assert.deepEqual(hosts, ["authority.example.org"]);
    options.validateUrl?.(new URL(url));
    return { url, status: 200, contentType: url.endsWith("robots.txt") ? "text/plain" : "application/rss+xml", body: url.endsWith("robots.txt") ? "User-agent: *\nAllow: /" : '<rss><channel><item><title>Track safety consultation opens</title><link>https://authority.example.org/records/safety</link><description>The racing authority opened a track safety consultation.</description></item></channel></rss>' };
  };
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [lead] }, undefined, undefined, createTargetedRetriever(registry, { fetchText }));
  const story = state.stories[0];
  assert.equal(story.status, "waiting_approval");
  assert.equal(story.sourceItems.length, 2);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.timeoutMs! > 0 && request.timeoutMs! <= 15_000));
  assert.ok(state.audit.some(event => event.action === "retrieval.completed"));
  assert.equal(state.publications.length, 0);
});

test("targeted retriever excludes disabled sources, off-origin feed links, unrelated records and expired budgets", async () => {
  let calls = 0;
  const fetchText: typeof safeFetchText = async (url) => {
    calls++;
    return { url, status: 200, contentType: url.endsWith("robots.txt") ? "text/plain" : "application/rss+xml", body: url.endsWith("robots.txt") ? "User-agent: *\nAllow: /" : '<rss><channel><item><title>Track safety consultation</title><link>https://evil.example.org/steal</link><description>Track safety consultation results.</description></item></channel></rss>' };
  };
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [lead] });
  const request = { story: state.stories[0], questions: ["Find the primary record"], sourceItems: [lead], maxItems: 2, deadline: Date.now() + 10_000 };
  const disabled = createTargetedRetriever([{ ...registry[0], enabled: false }], { fetchText });
  assert.equal((await disabled(request)).items.length, 0);
  assert.equal(calls, 0);
  const retrieve = createTargetedRetriever(registry, { fetchText });
  assert.equal((await retrieve({ ...request, deadline: Date.now() - 1 })).items.length, 0);
  assert.equal(calls, 0);
  const result = await retrieve(request);
  assert.equal(result.items.length, 0);
  assert.ok(result.errors?.some(error => error.message.includes("off-origin")));
  assert.equal(calls, 2);
});

test("engine accepts at most two additional retrieved items and preserves unresolved owner instructions", async () => {
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [lead] }, undefined, undefined, async request => {
    assert.equal(request.maxItems, 2);
    return { items: Array.from({ length: 5 }, (_, index) => ({ ...lead, id: `extra-${index}`, url: `https://authority.example.org/records/${index}`, type: "official" as const, sourceName: "Authority", content: "The racing authority opened a track safety consultation." })) };
  });
  assert.equal(state.stories[0].sourceItems.length, 3);
});
