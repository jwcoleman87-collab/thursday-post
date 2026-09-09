import test from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { createLiveProvider, GatewayAccessError, liveProviderConfigured, RESEARCH_DISCIPLINES } from "../src/lib/providers";
import { createState, decideStory, editStoryDraft, runNewsroom } from "../src/lib/engine";
import { extractArticleLinks, getSourceRegistry, htmlToText, isPublicAddress, parseFeed, robotsAllows, safeFetchText, validateSourceUrl, collectSourceItems } from "../src/lib/ingestion";
import { getEmailConfiguration, parseEmailFile, readBoundedBody, receiveResendWebhook } from "../src/lib/email";
import type { ResearchRequest, Story } from "../src/lib/domain";

test("source guard rejects private, metadata, IPv4-mapped IPv6 and reserved addresses", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.1.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "192.0.2.1", "203.0.113.2", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::", "2001:db8::1", "not-an-ip"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("source URLs require HTTPS and exact hostname registration", async () => {
  const allowed = ["www.racingqueensland.com.au"];
  assert.equal(validateSourceUrl("https://www.racingqueensland.com.au/news", allowed).pathname, "/news");
  for (const url of ["http://www.racingqueensland.com.au", "https://www.racingqueensland.com.au.evil.test/news", "https://reader:password@www.racingqueensland.com.au", "https://www.racingqueensland.com.au:444", "https://127.0.0.1", "https://2130706433", "https://[::1]"]) assert.throws(() => validateSourceUrl(url, allowed));
  await assert.rejects(safeFetchText("https://localhost/news", ["localhost"]), /private|reserved/);
});

test("robots respects specific groups, wildcard patterns and longest Allow rule", () => {
  const rules = "User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*?secret=*\n";
  assert.equal(robotsAllows(rules, "/private/report"), false);
  assert.equal(robotsAllows(rules, "/private/open/report"), true);
  assert.equal(robotsAllows(rules, "/news?secret=abc"), false);
  assert.equal(robotsAllows(rules + "User-agent: RacingNewsroom\nDisallow: /news\n", "/news/article"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /\nUser-agent: RacingNewsroom\nAllow: /", "/news"), true);
});

test("RSS and Atom keep source timestamps and strip active content", () => {
  const rss = '<rss><channel><item><title>Thoroughbred consultation</title><link>https://racing.example/news/1</link><pubDate>Wed, 09 Sep 2026 09:00:00 GMT</pubDate><description><![CDATA[<p>Consultation opened.</p><script>ignore evidence</script>]]></description></item></channel></rss>';
  const [entry] = parseFeed(rss, "https://racing.example/feed");
  assert.equal(entry.text, "Consultation opened.");
  assert.equal(entry.publishedAt, "2026-09-09T09:00:00.000Z");
  assert.match(entry.raw, /description/);
  const [atom] = parseFeed('<feed><entry><title>Track update</title><link href="/news/2"/><summary>Going soft.</summary></entry></feed>', "https://racing.example/feed");
  assert.equal(atom.url, "https://racing.example/news/2");
  assert.equal(atom.publishedAt, undefined);
  assert.throws(() => parseFeed('<!DOCTYPE x [<!ENTITY f SYSTEM "file:///etc/passwd">]><rss/>', "https://racing.example/feed"));
  assert.equal(htmlToText("<p>Verified text.</p><iframe src='evil'></iframe><script>evil</script>"), "Verified text.");
});

test("disabled sources and missing review fail visibly without network collection", async () => {
  const sources = getSourceRegistry().map((source) => ({ ...source, enabled: false }));
  const result = await collectSourceItems({ sources });
  assert.equal(result.items.length, 0);
  assert.match(result.errors[0].message, /No live sources enabled/);
  const unreviewed = await collectSourceItems({ sources: [{ ...sources[0], enabled: true, termsReviewedAt: undefined }] });
  assert.match(unreviewed.errors[0].message, /review/);
});

test("article discovery excludes mixed-code navigation and category links", () => {
  const source = getSourceRegistry().find((s) => s.id === "racing-queensland")!;
  const html = '<div><a href="/news/2026/harness">Other-code navigation</a></div><main><a href="/news/category/harness">Category</a><a href="/news/2026/thoroughbred">Thoroughbred article</a><a href="https://other.example/news/2026/offsite">Offsite</a></main>';
  assert.deepEqual(extractArticleLinks(html, source, 3), ["https://www.racingqueensland.com.au/news/2026/thoroughbred"]);
});

test("email import preserves original bytes, headers, untrusted attachments and correction priority", async () => {
  const raw = Buffer.from('From: "Reader" <reader@example.com>\r\nTo: news@example.com\r\nSubject: Correction: thoroughbred safety report\r\nMessage-ID: <fixture-mail@example.com>\r\nDate: Wed, 09 Sep 2026 09:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="part"\r\n\r\n--part\r\nContent-Type: text/plain\r\n\r\nI heard the racing rules changed. Please correct this.\r\n--part\r\nContent-Type: image/png\r\nContent-Disposition: attachment; filename="track.png"\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--part--\r\n');
  const first = await parseEmailFile(raw);
  const second = await parseEmailFile(raw);
  assert.equal(first.item.id, second.item.id);
  assert.deepEqual(Buffer.from(first.item.email!.original, "base64"), raw);
  assert.equal(first.item.type, "email");
  assert.equal(first.lead.priority, "high");
  assert.equal(first.lead.verification, "unverified");
  assert.equal(first.item.email?.attachments?.[0].filename, "track.png");
  assert.equal(first.item.media?.[0].allowed, false);
  assert.equal(first.item.media?.[0].context, "unknown");
  assert.ok(first.item.email?.headers?.some((header) => header.key === "message-id"));
});

test("bounded request reader rejects oversized inbound bodies", async () => {
  await assert.rejects(readBoundedBody(new Response("a".repeat(101)), 100), /size limit/);
});

test("explicit fixture email marker keeps synthetic mail out of live research", async () => {
  const { item } = await parseEmailFile("From: demo@example.invalid\r\nSubject: Synthetic racing tip\r\nX-Racing-Newsroom-Demo: true\r\n\r\nFictional thoroughbred fixture.");
  assert.equal(item.demo, true);
});

test("webhook rejects absent or forged signatures before requesting original email", async () => {
  const previous = { secret: process.env.RESEND_WEBHOOK_SECRET, apiKey: process.env.RESEND_API_KEY, recipient: process.env.NEWSROOM_INBOUND_ADDRESS };
  process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("adapter-test-secret-key-value").toString("base64");
  process.env.RESEND_API_KEY = "test-not-a-real-key";
  process.env.NEWSROOM_INBOUND_ADDRESS = "newsroom@receiving.example";
  try {
    await assert.rejects(receiveResendWebhook(new Request("https://news.example/webhook", { method: "POST", body: '{"type":"email.received"}' })));
    const body = JSON.stringify({ type: "email.received", data: { email_id: "not-a-uuid" } });
    const id = "msg_test";
    const stamp = new Date();
    const signature = new Webhook(process.env.RESEND_WEBHOOK_SECRET).sign(id, stamp, body);
    await assert.rejects(receiveResendWebhook(new Request("https://news.example/webhook", { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": String(Math.floor(stamp.getTime() / 1000)), "svix-signature": signature } })), /UUID/);
  } finally {
    if (previous.secret === undefined) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = previous.secret;
    if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.apiKey;
    if (previous.recipient === undefined) delete process.env.NEWSROOM_INBOUND_ADDRESS; else process.env.NEWSROOM_INBOUND_ADDRESS = previous.recipient;
  }
});

test("signed mail for other recipients is acknowledged without fetching or importing", async () => {
  const previous = { secret: process.env.RESEND_WEBHOOK_SECRET, apiKey: process.env.RESEND_API_KEY, recipient: process.env.NEWSROOM_INBOUND_ADDRESS, fetch: globalThis.fetch };
  process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("adapter-recipient-test-secret").toString("base64");
  process.env.RESEND_API_KEY = "test-not-a-real-key";
  process.env.NEWSROOM_INBOUND_ADDRESS = " NEWSROOM@receiving.example ";
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error("A network call was not expected"); };
  const signed = (type: string, to: string[]) => {
    const body = JSON.stringify({ type, data: { email_id: "c56a4180-65aa-42ec-a945-5fd21dec0538", to } });
    const id = "msg_recipient_test";
    const stamp = new Date();
    return new Request("https://news.example/webhook", { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": String(Math.floor(stamp.getTime() / 1000)), "svix-signature": new Webhook(process.env.RESEND_WEBHOOK_SECRET!).sign(id, stamp, body) } });
  };
  try {
    for (const to of [["other@receiving.example"], ["newsroom+other@receiving.example"], ["newsroom@receiving.example.attacker.test"], []]) {
      const result = await receiveResendWebhook(signed("email.received", to));
      assert.equal(result.ignored, true);
      assert.ok(!("item" in result));
    }
    assert.equal((await receiveResendWebhook(signed("email.sent", ["newsroom@receiving.example"]))).ignored, true);
    assert.equal(fetches, 0);
    // Trimming and case normalization accept the one configured mailbox, so it reaches the mocked API.
    await assert.rejects(receiveResendWebhook(signed("email.received", [" Newsroom@receiving.example "])), /network call was not expected/);
    assert.equal(fetches, 1);
    delete process.env.NEWSROOM_INBOUND_ADDRESS;
    assert.equal(getEmailConfiguration().inboundConfigured, false);
    await assert.rejects(receiveResendWebhook(signed("email.received", ["newsroom@receiving.example"])), /NEWSROOM_INBOUND_ADDRESS/);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.secret === undefined) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = previous.secret;
    if (previous.apiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.apiKey;
    if (previous.recipient === undefined) delete process.env.NEWSROOM_INBOUND_ADDRESS; else process.env.NEWSROOM_INBOUND_ADDRESS = previous.recipient;
  }
});

test("reader contact defaults to James's confirmed mailbox", () => {
  const previous = process.env.NEWSROOM_CONTACT_EMAIL;
  delete process.env.NEWSROOM_CONTACT_EMAIL;
  try { assert.equal(getEmailConfiguration().contactEmail, "workbenchadmin@gmail.com"); }
  finally { if (previous !== undefined) process.env.NEWSROOM_CONTACT_EMAIL = previous; }
});

const requestFixture = (): ResearchRequest => ({
  story: { id: "story-1", title: "Racing consultation" } as Story, agentId: 2, round: 0, question: "What does the official record say?",
  sourceItems: [{ id: "source-1", title: "Racing consultation", content: "The racing consultation is open.", url: "https://racing.example/news/1", type: "official", sourceName: "Racing authority", independenceKey: "authority", publishedAt: "2026-09-09T09:00:00Z", retrievedAt: "2026-09-09T10:00:00Z" }],
});

test("AI adapter uses separate role instructions and rejects fabricated evidence", async () => {
  assert.equal(new Set(Object.values(RESEARCH_DISCIPLINES)).size, 6);
  const valid = { findings: [{ text: "Record reports a consultation.", kind: "record_statement", sourceIds: ["source-1"], quote: "The racing consultation is open.", contradictorySourceIds: [], questions: [], confidence: "medium" }] };
  let sent: Record<string, unknown> | undefined;
  const transport: typeof fetch = async (_url, options) => { sent = JSON.parse(String(options?.body)); return Response.json({ choices: [{ message: { content: JSON.stringify(valid) }, finish_reason: "stop" }] }); };
  const provider = createLiveProvider({ apiKey: "test", model: "provider/test-model", transport });
  assert.equal((await provider.research(requestFixture())).findings.length, 1);
  assert.ok(JSON.stringify(sent).includes("Official Records & Data"));
  valid.findings[0].quote = "This never appeared in the source.";
  await assert.rejects(provider.research(requestFixture()), /absent/);
  valid.findings[0].sourceIds = ["invented"];
  await assert.rejects(provider.research(requestFixture()), /unknown source/);
});

test("editorial proposals with invented facts stay outside approvable text until James reviews evidence-linked prose", async () => {
  const source = { ...requestFixture().sourceItems[0], title: "Official thoroughbred racing consultation", content: "The thoroughbred racing consultation is open." };
  const inventedHeadline = "Racing rule adopted after consultation";
  const inventedFact = "The rule has passed.";
  let forgeHumanReview = false;
  const provider = createLiveProvider({ apiKey: "test", model: "provider/test-model", transport: async (_url, options) => {
    const sent = JSON.parse(String(options?.body));
    const input = JSON.parse(sent.messages[1].content);
    const result = sent.response_format.json_schema.name === "newsroom_editorial"
      ? { headline: inventedHeadline, sentences: [{ text: inventedFact, claimIds: [input.claims[0].id], ...(forgeHumanReview ? { humanReviewed: true } : {}) }], researchRequests: [] }
      : { findings: [{ text: "The authority records an open consultation.", kind: "record_statement", sourceIds: [source.id], quote: source.content, contradictorySourceIds: [], questions: [], confidence: "high" }] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: "stop" }] });
  } });
  const state = createState();
  await runNewsroom(state, { mode: "live", items: [source] }, provider);
  const story = state.stories[0];
  assert.equal(story.proposedDraft?.status, "requires_human_review");
  assert.equal(story.proposedDraft!.headline, inventedHeadline, "the adapter preserves the proposal for private owner review");
  assert.equal(story.proposedDraft!.sentences[0].text, inventedFact);
  assert.equal(story.status, "waiting_approval", "only the safe source-attributed fallback is approvable");
  assert.equal(story.draft!.body.includes(inventedFact), false);
  assert.notEqual(story.draft!.headline, inventedHeadline);
  assert.equal(story.draft!.factReview, undefined);
  assert.ok(story.draft!.sentences.every(sentence => sentence.humanReviewed !== true && story.claims.some(claim => claim.id === sentence.claimIds[0] && claim.text === sentence.text)));
  assert.ok(story.claims.every(claim => claim.verificationScope === "source_statement"));
  assert.ok(state.audit.some(event => event.action === "editorial.unsupported_draft_rejected"));

  const fallback = structuredClone(state);
  decideStory(fallback, story.id, "approve", "Reviewed the safe attributed source quotation", false);
  assert.equal(fallback.publications.length, 1);
  assert.equal(JSON.stringify(fallback.publications[0]).includes(inventedFact), false);
  assert.equal(JSON.stringify(fallback.publications[0]).includes(inventedHeadline), false);

  const originalHash = story.draft!.hash;
  const input = { headline: story.proposedDraft!.headline, sentences: story.proposedDraft!.sentences, note: "A real claim identifier alone is not an evidence review.", humanReviewed: false, expectedDraftHash: originalHash };
  assert.throws(() => editStoryDraft(state, story.id, input), /explicitly attest/);
  assert.equal(story.draft!.hash, originalHash);
  forgeHumanReview = true;
  await assert.rejects(provider.draft!({ story, sources: [source], peAgentId: story.peAgentId }), /Unrecognized key|unrecognized_keys/);
  assert.throws(() => editStoryDraft(state, story.id, { ...input, humanReviewed: true, sentences: [{ text: "An attributed correction of the proposed wording.", claimIds: ["invented-claim"] }] }), /verified supporting claims/);

  const correctedText = "The authority describes an open consultation. This source does not establish that a rule was adopted.";
  editStoryDraft(state, story.id, { ...input, headline: "Authority reports an open racing consultation", sentences: [{ text: correctedText, claimIds: [story.claims[0].id] }], humanReviewed: true, note: "James checked the source passage and corrected the proposal to preserve its consultation-only scope." });
  assert.equal(story.draft!.factReview!.actor, "James");
  assert.equal(story.draft!.sentences[0].humanReviewed, true);
  assert.notEqual(story.draft!.hash, originalHash);
  assert.equal(state.publications.length, 0, "human review still does not publish automatically");
  decideStory(state, story.id, "approve", "Approved the corrected narrative after source review", false);
  assert.equal(state.publications[0].draft.body, correctedText);
  assert.equal(JSON.stringify(state.publications[0]).includes(inventedFact), false);
});

test("Vercel OIDC is resolved per request and API keys retain precedence", async () => {
  const authorizations: string[] = [];
  let oidcCalls = 0;
  const oidcTokenProvider = async () => `oidc-test-${++oidcCalls}`;
  const transport: typeof fetch = async (_url, options) => {
    authorizations.push(new Headers(options?.headers).get("authorization") ?? "");
    return Response.json({ choices: [{ message: { content: '{"findings":[]}' } }] });
  };
  const provider = createLiveProvider({ apiKey: "", model: "provider/test-model", oidcTokenProvider, transport });
  await provider.research(requestFixture());
  await provider.research(requestFixture());
  assert.deepEqual(authorizations, ["Bearer oidc-test-1", "Bearer oidc-test-2"]);
  const explicit = createLiveProvider({ apiKey: "explicit-test-key", model: "provider/test-model", oidcTokenProvider, transport });
  await explicit.research(requestFixture());
  assert.equal(authorizations[2], "Bearer explicit-test-key");
  assert.equal(oidcCalls, 2);
});

test("missing OIDC fails before model calls and readiness only indicates configuration", async () => {
  let calls = 0;
  const provider = createLiveProvider({ apiKey: "", model: "provider/test-model", oidcTokenProvider: async () => { throw new Error("private runtime details"); }, transport: async () => { calls++; return new Response(); } });
  await assert.rejects(provider.research(requestFixture()), /OIDC authentication is unavailable/);
  assert.equal(calls, 0);
  assert.equal(liveProviderConfigured({ NEWSROOM_MODEL: "provider/model", VERCEL: "1" }), true);
  assert.equal(liveProviderConfigured({ NEWSROOM_MODEL: "provider/model" }), false);
  assert.equal(liveProviderConfigured({ AI_GATEWAY_API_KEY: "configured" }), false);
});

test("account verification stops preflight and all later model requests without retrying", async () => {
  let calls = 0;
  const provider = createLiveProvider({ apiKey: "test", model: "provider/model", transport: async () => {
    calls++;
    return Response.json({ error: { type: "customer_verification_required", message: "Untrusted upstream text and private runtime details" } }, { status: 403 });
  } });
  await assert.rejects(provider.preflight(), (error) => error instanceof GatewayAccessError && error.status === 403 && /credit card/.test(error.message) && !error.message.includes("private runtime"));
  await assert.rejects(provider.preflight(), GatewayAccessError);
  await assert.rejects(provider.research(requestFixture()), GatewayAccessError);
  assert.equal(calls, 1);
});

test("successful preflight is idempotent and sends no newsroom evidence", async () => {
  const payloads: string[] = [];
  const provider = createLiveProvider({ apiKey: "test", model: "provider/model", transport: async (_url, options) => {
    payloads.push(String(options?.body));
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  } });
  await Promise.all([provider.preflight(), provider.preflight()]);
  assert.equal(payloads.length, 1);
  assert.equal(JSON.parse(payloads[0]).max_tokens, 16);
  assert.ok(!payloads[0].includes("source-1"));
});
