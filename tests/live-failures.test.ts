import assert from "node:assert/strict";
import test from "node:test";
import { createLiveProvider, parseRetryAfter, resolveQuoteToSource, GATEWAY_PACING } from "../src/lib/providers";
import type { SourceItem } from "../src/lib/domain";

/**
 * Regressions for the failures observed in the first hosted live run (10 September):
 *   1. Four model responses rejected with "AI research supplied a quote absent from its
 *      source excerpt" — typographic drift, not fabrication.
 *   2. Immediate retries and fan-out then hit HTTP 429 with no pacing or backoff.
 */

const SOURCE_TEXT = [
  "Racing Queensland’s stewards said the gelding “was withdrawn on veterinary advice”",
  "before the fourth race — a decision the club described as routine.",
].join("\n  ");

function sourceItem(content: string): SourceItem {
  return {
    id: "src-live-1", sourceName: "Racing Queensland", type: "official",
    url: "https://www.racingqueensland.com.au/stewards", independenceKey: "rq",
    publishedAt: "2026-09-09T00:00:00.000Z", retrievedAt: "2026-09-09T01:00:00.000Z",
    region: "QLD", title: "Stewards report", content,
  } satisfies SourceItem;
}

function gateway(handler: (attempt: number) => Response, findings?: unknown) {
  const attempts: number[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const provider = createLiveProvider({
    apiKey: "test-only-placeholder", model: "fixture/model",
    transport: async (_url, options) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        const name = JSON.parse(String(options?.body)).response_format.json_schema.name as string;
        attempts.push(attempts.length);
        if (name === "newsroom_research" && findings) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return Response.json({ choices: [{ message: { content: JSON.stringify({ findings }) } }], usage: {} });
        }
        return handler(attempts.length - 1);
      } finally { inFlight -= 1; }
    },
  });
  return { provider, attempts, peak: () => peakInFlight };
}

function researchRequest(item: SourceItem) {
  return {
    story: { id: "story-1", title: "Stewards report" },
    agentId: 2 as const, round: 0, question: "What did the stewards record?", sourceItems: [item],
  } as never;
}

test("quote resolution accepts typographic drift and stores the verbatim source passage", async () => {
  const item = sourceItem(SOURCE_TEXT);
  // The model re-typesets: straight quotes, plain hyphen, collapsed whitespace, lowercased.
  const retyped = 'racing queensland\'s stewards said the gelding "was withdrawn on veterinary advice" before the fourth race - a decision';
  const { provider } = gateway(() => Response.json({}), [
    { text: "Stewards recorded a veterinary withdrawal.", kind: "record_statement", sourceIds: [item.id], quote: retyped, contradictorySourceIds: [], questions: [], confidence: "high" },
  ]);
  const result = await provider.research(researchRequest(item));
  const stored = result.findings[0].quote ?? "";
  assert.ok(item.content.includes(stored), "Recorded evidence must be an exact substring of the source");
  assert.ok(stored.includes("’") && stored.includes("“"), "Verbatim source typography is preserved, not the model's rendering");
  assert.notEqual(stored, retyped, "The model's re-typed rendering must never be stored as evidence");
});

test("a quote absent from the supplied excerpt is discarded without retrying the model", async () => {
  const item = sourceItem(SOURCE_TEXT);
  const { provider } = gateway(() => Response.json({}), [
    { text: "Fabricated.", kind: "fact", sourceIds: [item.id], quote: "the stewards admitted a cover-up", contradictorySourceIds: [], questions: [], confidence: "high" },
  ]);
  const result = await provider.research(researchRequest(item));
  assert.deepEqual(result.findings, []);
});

test("quote resolution does not accept a reordered or partially invented passage", () => {
  assert.equal(resolveQuoteToSource("veterinary advice was withdrawn on", SOURCE_TEXT), null);
  assert.equal(resolveQuoteToSource("was withdrawn on veterinary guidance", SOURCE_TEXT), null);
  assert.equal(resolveQuoteToSource("", SOURCE_TEXT), null);
});

test("Retry-After is honoured in seconds and as an HTTP date", () => {
  const from = Date.parse("2026-09-10T00:00:00.000Z");
  assert.equal(parseRetryAfter("2"), 2000);
  assert.equal(parseRetryAfter("0"), 0);
  assert.equal(parseRetryAfter("Thu, 10 Sep 2026 00:00:30 GMT", from), 30_000);
  assert.equal(parseRetryAfter("not-a-header"), null);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter("-5"), 0, "A stale header must never produce a negative wait");
});

test("a rate-limited run backs off once, then fails fast without further requests", async () => {
  const { provider, attempts } = gateway((attempt) =>
    attempt === 0
      ? new Response("{}", { status: 429, headers: { "retry-after": "0" } })
      : new Response("{}", { status: 429, headers: { "retry-after": "60" } }));

  const started = Date.now();
  await assert.rejects(provider.preflight(), /rate limited/);
  assert.equal(attempts.length, GATEWAY_PACING.maxRetries + 1, "Exactly one bounded retry, not a storm");

  // The breaker now short-circuits every other agent in the fan-out.
  const before = attempts.length;
  await assert.rejects(provider.research(researchRequest(sourceItem(SOURCE_TEXT))), /rate limited/);
  assert.equal(attempts.length, before, "A tripped rate-limit breaker must issue no further requests");
  assert.ok(Date.now() - started < 10_000, "Failing fast must not consume the run deadline");
});

test("a Retry-After longer than the request deadline fails immediately rather than waiting", async () => {
  const { provider, attempts } = gateway(() => new Response("{}", { status: 429, headers: { "retry-after": "600" } }));
  const started = Date.now();
  await assert.rejects(provider.preflight(), /rate limited/);
  assert.equal(attempts.length, 1, "No retry may be scheduled beyond the request deadline");
  assert.ok(Date.now() - started < 5_000);
});

test("a 429 without Retry-After trips the breaker without a speculative retry", async () => {
  const { provider, attempts } = gateway(() => new Response("{}", { status: 429 }));
  await assert.rejects(provider.preflight(), /rate limited/);
  assert.equal(attempts.length, 1);
  await assert.rejects(provider.research(researchRequest(sourceItem(SOURCE_TEXT))), /rate limited/);
  assert.equal(attempts.length, 1, "The shared breaker must contain an undeclared quota window");
});

test("concurrent research is paced within the bounded dispatch limit", async () => {
  const item = sourceItem(SOURCE_TEXT);
  const { provider, peak } = gateway(() => Response.json({}), [
    { text: "Stewards recorded a veterinary withdrawal.", kind: "record_statement", sourceIds: [item.id], quote: "was withdrawn on veterinary advice", contradictorySourceIds: [], questions: [], confidence: "high" },
  ]);
  await Promise.all(Array.from({ length: 6 }, () => provider.research(researchRequest(item))));
  assert.ok(peak() <= GATEWAY_PACING.maxConcurrent, `Peak in-flight ${peak()} exceeded the pacing limit`);
});
