import { createHash } from "node:crypto";
import type { ArticleDraft, ArticleSentence, Claim, ComplianceCheck, EvidenceGap, FindingInput, FormAnalysis, FormRunner, NewsroomState, PeAgentId, ResearchAgentId, ResearchProvider, ResearchRequest, ResearchResult, SourceItem, Story, Publication, TargetedRetriever } from "./domain";
import { PE_AGENTS, RESEARCH_AGENTS } from "./domain";
import { demoResearchProvider } from "./fixtures";
import { GATEWAY_PACING } from "./providers";
import { checkWagering, isWagering } from "./policy";

export const BUDGET = { maxStories: 3, maxLiveStories: 1, maxRounds: 2, retries: 1, taskTimeoutMs: 32_000, maxRunMs: 180_000, maxFindings: 8, maxQuoteWordsPerSource: 25, maxAdditionalSources: 2, retrievalTimeoutMs: 20_000 } as const;
const now = () => new Date().toISOString();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const stableId = (prefix: string, value: string) => `${prefix}-${digest(value).slice(0, 20)}`;
const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const relevant = (item: SourceItem) => /\b(thoroughbred|racing|racecourse|jockey|trainer|horse|stewards?|bloodstock|yearling|foal|mare|stallion|race club|scratchings?|barriers?)\b/i.test(`${item.title} ${item.content}`);

export function createState(): NewsroomState {
  return { schemaVersion: 1, stories: [], sourceItems: [], tasks: [], runs: [], audit: [], publications: [] };
}

function audit(state: NewsroomState, action: string, detail: string, storyId?: string) {
  state.audit.push({ id: stableId("audit", `${state.audit.length}|${action}|${storyId}|${now()}`), ...(storyId ? { storyId } : {}), action, detail, createdAt: now() });
}

function transition(state: NewsroomState, story: Story, status: Story["status"], detail: string) {
  story.status = status;
  story.updatedAt = now();
  audit(state, `story.${status}`, detail, story.id);
}

export function routeStory(items: SourceItem[]): { researchAgentIds: ResearchAgentId[]; peAgentId: PeAgentId } {
  const text = items.map(i => `${i.title} ${i.content} ${i.region ?? ""}`).join(" ");
  const agents = new Set<ResearchAgentId>([1, 2]);
  if (/\b(vet(?:erinary)?|welfare|injur|analysis|research|study|technology|business|sale|bloodstock|breeding)\w*/i.test(text)) agents.add(3);
  if (items.some(i => i.type === "email" || i.type === "social")) agents.add(4);
  if (items.some(i => i.type === "media" || i.media?.length)) agents.add(5);
  if (items.some(i => i.region) || /\b(international|japan|hong kong|britain|france|ireland|new zealand|nsw|victoria|queensland)\b/i.test(text)) agents.add(6);
  let peAgentId: PeAgentId = 2;
  if (/\b(business|sale|sales|bloodstock|breeding|technology|wagering|market|economic|commercial)\w*/i.test(text)) peAgentId = 3;
  if (/\b(governance|authority|authorities|stewards?|policy|regulat|consultation|inquiry|suspension|government)\w*/i.test(text)) peAgentId = 1;
  if (/\b(international|japan|hong kong|britain|france|ireland|new zealand|overseas|dubai)\b/i.test(text)) peAgentId = 4;
  return { researchAgentIds: [...agents].sort(), peAgentId };
}

function addSource(state: NewsroomState, item: SourceItem, mode: Story["mode"]) {
  if (!item.id || !item.content || !item.title || !item.sourceName || !item.independenceKey || !item.url) throw new Error("Source item is missing required provenance.");
  if (mode === "live" && (item.demo || item.url.includes("example.invalid"))) throw new Error("Synthetic demo sources are forbidden in live runs.");
  if (!Number.isFinite(Date.parse(item.retrievedAt)) || !Number.isFinite(Date.parse(item.publishedAt))) throw new Error("Source timestamps must be valid ISO dates.");
  const existing = state.sourceItems.find(s => s.id === item.id);
  if (existing && (existing.content !== item.content || existing.url !== item.url)) throw new Error(`Immutable source ${item.id} changed; ingest the revision with a new source ID.`);
  if (!existing) state.sourceItems.push(structuredClone(item));
}

function sourceItems(state: NewsroomState, story: Story) { return state.sourceItems.filter(s => story.sourceItems.includes(s.id)); }

function operationalGap(state: NewsroomState, story: Story, gap: EvidenceGap): boolean {
  return gap.id === stableId("gap", `${story.id}|wall-clock-budget`) || state.tasks.some(task => task.storyId === story.id && gap.id === stableId("gap", `${story.id}|task-failure-${task.id}`));
}

function recoverAgent(state: NewsroomState, story: Story, agentId: ResearchAgentId) {
  for (const gap of story.gaps.filter(g => g.status === "open" && g.agentId === agentId && operationalGap(state, story, g))) {
    gap.status = "resolved";
    gap.resolution = `Research Agent ${agentId} successfully completed a bounded request after the operational failure. Separate evidence and editorial questions still require their own resolution.`;
    audit(state, "controller.operation_recovered", gap.resolution, story.id);
  }
}

function addGap(state: NewsroomState, story: Story, question: string, agentId: ResearchAgentId, blocking: boolean, key = question) {
  const id = stableId("gap", `${story.id}|${key}`);
  const old = story.gaps.find(g => g.id === id);
  if (old) return old;
  const gap: EvidenceGap = { id, question, agentId, status: "open", blocking, claimIds: [], createdAt: now() };
  story.gaps.push(gap);
  audit(state, "controller.gap_identified", `Research Agent ${agentId}: ${question}`, story.id);
  return gap;
}

function exactExcerpt(source: SourceItem, quote: string | undefined): string | null {
  if (!quote || quote.length < 12 || quote.length > 700) return null;
  const cleaned = quote.trim();
  if (!source.content.includes(cleaned)) return null;
  // Preserve a contiguous literal excerpt, with a strict per-source article word budget below.
  const words = [...cleaned.matchAll(/\S+/g)];
  const end = words.length > BUDGET.maxQuoteWordsPerSource ? words[BUDGET.maxQuoteWordsPerSource - 1].index! + words[BUDGET.maxQuoteWordsPerSource - 1][0].length : cleaned.length;
  return cleaned.slice(0, end);
}

/** Verification here proves only that an archived public record contains the quote. */
function absorbFinding(state: NewsroomState, story: Story, taskId: string, agentId: ResearchAgentId, input: FindingInput) {
  if (!input || typeof input.text !== "string" || !Array.isArray(input.sourceIds)) throw new Error("Research provider returned an invalid finding.");
  const items = sourceItems(state, story);
  const sources = input.sourceIds.map(id => items.find(s => s.id === id)).filter((s): s is SourceItem => !!s);
  const valid = sources.filter(s => exactExcerpt(s, input.quote));
  const contradictory = (input.contradictorySourceIds ?? []).map(id => items.find(s => s.id === id)).filter((s): s is SourceItem => !!s);
  const publicRecords = valid.filter(s => ["official", "data", "publication"].includes(s.type) && /^https?:\/\//.test(s.url));
  const provenStatement = input.kind === "record_statement" && publicRecords.length > 0 && !contradictory.length;
  const recorded = publicRecords[0];
  const quote = recorded ? exactExcerpt(recorded, input.quote)! : (input.quote ?? "").slice(0, 700);
  const text = provenStatement ? `${recorded.sourceName} states: “${quote}”` : input.text.slice(0, 1500);
  const id = stableId("claim", `${story.id}|${input.kind}|${text}`);
  const evidence = [...sources.map(s => ({ source: s, relation: "supports" as const })), ...contradictory.map(s => ({ source: s, relation: "contradicts" as const }))].map(({ source, relation }) => ({
    id: stableId("evidence", `${id}|${source.id}|${relation}`), sourceId: source.id, quote: relation === "supports" ? quote : "Contradictory source flagged by researcher; evaluate original record.", relation, exactMatch: relation === "supports" && !!exactExcerpt(source, input.quote), independenceKey: source.independenceKey, recordedAt: now(),
  }));
  const existing = story.claims.find(claim => claim.id === id);
  const claim: Claim = existing ?? { id, text, kind: provenStatement ? "record_statement" : input.kind, agentId, evidence, status: contradictory.length ? "disputed" : provenStatement ? "verified" : "unverified", verificationScope: provenStatement ? "source_statement" : "unverified", confidence: provenStatement ? "high" : "low", questions: (input.questions ?? []).filter(q => typeof q === "string").slice(0, 5), createdAt: now() };
  if (existing) {
    for (const reference of evidence) if (!existing.evidence.some(e => e.id === reference.id)) existing.evidence.push(reference);
    if (contradictory.length) { existing.status = "disputed"; existing.confidence = "low"; }
    existing.questions = [...new Set([...existing.questions, ...(input.questions ?? [])])].slice(0, 5);
  }
  if (!provenStatement && !claim.questions.length) claim.questions.push("Underlying claim has not been independently established; do not publish as fact.");
  if (!existing) story.claims.push(claim);
  const findingId = stableId("finding", `${taskId}|${id}`);
  if (!story.findings.some(finding => finding.id === findingId)) story.findings.push({ id: findingId, storyId: story.id, taskId, agentId, claimIds: [id], summary: provenStatement ? "Exact archived source quotation verified; underlying assertion is not independently proven." : "Unverified or disputed finding retained as a research lead.", createdAt: now() });
  audit(state, "hub.finding_recorded", `Agent ${agentId}: ${claim.status}; ${claim.verificationScope}; ${sources.length} source reference(s), ${new Set(sources.map(s => s.independenceKey)).size} independent origin(s).`, story.id);
}

const recordProvider: ResearchProvider = {
  async research(request) {
    const acceptable = request.sourceItems.filter(s => request.agentId === 2 ? ["official", "data"].includes(s.type) : request.agentId === 1 ? s.type === "publication" : request.agentId === 4 ? ["email", "social"].includes(s.type) : false);
    return { findings: acceptable.slice(0, 4).map(s => {
      const sentence = s.content.match(/[^.!?]+[.!?](?:\s|$)/)?.[0]?.trim() ?? s.content.slice(0, 280);
      const quote = sentence.slice(0, 280);
      return { text: quote, kind: ["email", "social"].includes(s.type) ? "allegation" as const : "record_statement" as const, sourceIds: [s.id], quote, confidence: "low" as const };
    }) };
  },
};

/**
 * Run tasks with bounded concurrency. Unbounded Promise.all fan-out starts every task's
 * wall-clock timeout at once and dispatches every request simultaneously, which is what
 * produced the observed 429 storm. The limit matches GATEWAY_PACING.maxConcurrent so no
 * task sits queued inside the provider burning its own timeout.
 */
async function mapBounded<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await run(items[index]);
    }
  });
  await Promise.all(workers);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`Research task exceeded ${ms / 1000}s timeout.`)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function researchTask(state: NewsroomState, story: Story, agentId: ResearchAgentId, round: number, question: string, provider: ResearchProvider, deadline: number) {
  const revision = story.approvals.filter(a => a.decision === "send_back").length;
  const baseId = stableId("task", `${story.id}|${revision}|${agentId}|${round}|${question}|${[...story.sourceItems].sort().join(",")}`);
  let id = baseId;
  let task = state.tasks.find(t => t.id === id);
  let retryGeneration = 0;
  while (task?.status === "failed") {
    retryGeneration += 1;
    id = stableId("task", `${baseId}|later-run-retry-${retryGeneration}`);
    task = state.tasks.find(t => t.id === id);
  }
  if (task?.status === "completed") return;
  if (!task) {
    task = { id, storyId: story.id, agentId, round, question, status: "pending", attempts: 0, createdAt: now() };
    state.tasks.push(task);
    if (retryGeneration) audit(state, "research.retry_scheduled", `A later GO run grants task ${baseId} a fresh bounded attempt budget. Previous failed tasks and runs remain archived.`, story.id);
  }
  const startedAt = now();
  task.status = "running";
  audit(state, round ? "controller.targeted_research" : "research.assigned", `Research Agent ${agentId} — ${question}`, story.id);
  for (; task.attempts <= BUDGET.retries;) {
    task.attempts += 1;
    try {
      if (Date.now() >= deadline) throw new Error("Whole-run wall-clock budget exhausted; more research requires a later run.");
      const request: ResearchRequest = { story: structuredClone(story), agentId, round, question, sourceItems: structuredClone(sourceItems(state, story)) };
      const result: ResearchResult = await withTimeout(provider.research(request), Math.min(BUDGET.taskTimeoutMs, deadline - Date.now()));
      if (!result || !Array.isArray(result.findings)) throw new Error("Research provider returned no structured findings.");
      for (const source of (result.sources ?? []).slice(0, 8)) {
        addSource(state, source, story.mode);
        if (!story.sourceItems.includes(source.id)) story.sourceItems.push(source.id);
      }
      for (const finding of result.findings.slice(0, BUDGET.maxFindings)) absorbFinding(state, story, id, agentId, finding);
      task.status = "completed";
      task.finishedAt = now();
      delete task.error;
      state.runs.push({ id: stableId("run", `${id}|${task.attempts}|${state.runs.length}`), storyId: story.id, agentType: "research", agentId, taskId: id, status: "completed", summary: `${result.findings.length} structured finding(s); no inference promoted by model confidence.`, startedAt, finishedAt: now() });
      recoverAgent(state, story, agentId);
      return;
    } catch (error) {
      task.error = error instanceof Error ? error.message : "Unknown research provider error.";
      audit(state, "research.attempt_failed", `Agent ${agentId}, attempt ${task.attempts}: ${task.error}`, story.id);
    }
  }
  task.status = "failed";
  task.finishedAt = now();
  state.runs.push({ id: stableId("run", `${id}|failed|${state.runs.length}`), storyId: story.id, agentType: "research", agentId, taskId: id, status: "failed", summary: task.error ?? "Retry budget exhausted.", startedAt, finishedAt: now() });
  const failure = addGap(state, story, `Research Agent ${agentId} failed after ${task.attempts} attempts: ${task.error}`, agentId, true, `task-failure-${id}`);
  failure.status = "open";
  delete failure.resolution;
}

function assess(state: NewsroomState, story: Story) {
  const items = sourceItems(state, story);
  const primary = story.claims.filter(c => c.status === "verified" && c.verificationScope === "source_statement" && c.evidence.some(e => e.exactMatch && items.some(s => s.id === e.sourceId && ["official", "data"].includes(s.type))));
  const key = stableId("gap", `${story.id}|primary-record`);
  if (!primary.length) addGap(state, story, "Locate the primary racing authority or data record for this lead and quote the relevant passage exactly. Distinguish an announced proposal or allegation from an adopted decision or established result.", 2, true, "primary-record");
  else {
    const gap = story.gaps.find(g => g.id === key);
    if (gap && gap.status === "open") {
      gap.status = "resolved";
      gap.claimIds = primary.map(c => c.id);
      gap.resolution = "A primary-source passage is now archived and quoted. This closes the missing-record gap; it does not prove every assertion in that record.";
      audit(state, "controller.gap_resolved", gap.resolution, story.id);
    }
  }
  for (const media of story.media) {
    media.allowed = !!media.earliestSource && media.context === "verified" && !!media.date && !!media.location && media.manipulation === "not_detected" && media.aiStatus === "no_evidence" && media.captionSupported && media.rights === "cleared";
    if (!media.allowed) addGap(state, story, `Image ${media.id}: verify earliest source, date, location, reuse, manipulation, AI status, caption and usage rights. Omit this image while any field is unknown.`, 5, false, `image-${media.id}`);
  }
}

export function draftHash(draft: Pick<ArticleDraft, "headline" | "byline" | "peAgentId" | "sentences" | "body" | "limitations" | "factReview" | "reviewRevision" | "label" | "deck" | "dateline" | "captions" | "access">): string {
  return digest(JSON.stringify({ headline: draft.headline, byline: draft.byline, peAgentId: draft.peAgentId, sentences: draft.sentences, body: draft.body, limitations: draft.limitations, factReview: draft.factReview, reviewRevision: draft.reviewRevision, label: draft.label, deck: draft.deck, dateline: draft.dateline, captions: draft.captions, access: draft.access }));
}

function verifiedClaim(state: NewsroomState, story: Story, id: string): Claim | undefined {
  return story.claims.find(claim => claim.id === id && claim.status === "verified" && claim.verificationScope === "source_statement" && !claim.evidence.some(e => e.relation === "contradicts") && claim.evidence.some(e => e.exactMatch && e.relation === "supports" && state.sourceItems.some(source => story.sourceItems.includes(source.id) && source.id === e.sourceId && ["official", "data", "publication"].includes(source.type) && source.content.includes(e.quote) && (story.mode === "demo" || (!source.demo && !source.url.includes("example.invalid"))))));
}

function supportedSentence(state: NewsroomState, story: Story, sentence: ArticleSentence): boolean {
  if (!sentence.claimIds.length || !sentence.claimIds.every(id => verifiedClaim(state, story, id))) return false;
  if (sentence.claimIds.length === 1 && story.claims.find(c => c.id === sentence.claimIds[0])?.text === sentence.text) return true;
  return sentence.humanReviewed === true && story.draft?.factReview?.actor === "James" && story.draft.factReview.note.trim().length >= 10;
}

function quotationBudgetMet(story: Story, draft: ArticleDraft): boolean {
  const text = [draft.headline, draft.deck, draft.body, ...(draft.captions ?? []).map(caption => caption.text)].filter(Boolean).join("\n");
  const ranges = new Map<string, { start: number; end: number }[]>();
  for (const claim of story.claims) for (const evidence of claim.evidence) {
    if (!evidence.exactMatch || evidence.relation !== "supports" || !evidence.quote) continue;
    for (let start = text.indexOf(evidence.quote); start >= 0; start = text.indexOf(evidence.quote, start + evidence.quote.length)) {
      ranges.set(evidence.sourceId, [...(ranges.get(evidence.sourceId) ?? []), { start, end: start + evidence.quote.length }]);
    }
  }
  for (const entries of ranges.values()) {
    const merged: { start: number; end: number }[] = [];
    for (const entry of entries.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && entry.start <= last.end) last.end = Math.max(last.end, entry.end);
      else merged.push({ ...entry });
    }
    if (merged.reduce((count, range) => count + text.slice(range.start, range.end).trim().split(/\s+/).length, 0) > BUDGET.maxQuoteWordsPerSource) return false;
  }
  return true;
}

function checks(state: NewsroomState, story: Story): ComplianceCheck[] {
  const checkedAt = now();
  const draft = story.draft;
  const supported = !!draft?.sentences.length && draft.body === draft.sentences.map(sentence => sentence.text).join("\n\n") && quotationBudgetMet(story, draft) && draft.sentences.every(sentence => supportedSentence(state, story, sentence));
  const blockers = story.gaps.filter(g => g.status === "open" && g.blocking);
  const replyOutstanding = story.editorialTone === "B" && (!story.rightOfReply || story.rightOfReply.status === "requested");
  const allDraftText = [draft?.headline, draft?.deck, draft?.body, ...(draft?.captions ?? []).map(caption => caption.text)].filter(Boolean).join("\n");
  story.wagering ||= isWagering(allDraftText);
  const output: ComplianceCheck[] = [
    { id: `${story.id}-evidence`, gate: "evidence", status: supported && !blockers.length ? "passed" : "blocked", message: supported && !blockers.length ? draft?.factReview ? "James reviewed the narrative against linked archived evidence. This editorial attestation does not independently prove source assertions." : "Every article sentence maps to an exact archived quotation. Verification scope is the source statement; underlying claims remain attributed." : `Evidence incomplete: ${blockers.length} blocking question(s); ${supported ? "sentence provenance intact" : "missing or invalid sentence provenance"}.`, checkedAt },
    { id: `${story.id}-imagery`, gate: "imagery", status: story.media.length ? story.media.every(m => m.allowed) ? "passed" : "warning" : "not_applicable", message: story.media.length ? story.media.every(m => m.allowed) ? "All proposed images have required provenance and caption checks." : "Images with unknown provenance, context or rights are excluded from publication." : "No image is included.", checkedAt },
    checkWagering(draft ? { ...story, draft: { ...draft, body: allDraftText } } : story),
    { id: `${story.id}-publication`, gate: "publication", status: replyOutstanding ? "blocked" : "passed", message: replyOutstanding ? "Adverse reporting needs James's recorded right-of-reply outcome or reason it is not required." : story.mode === "demo" ? "Synthetic demonstration. Approval creates a private demo publication only." : "Explicit James approval must match the exact immutable draft hash before public publication.", checkedAt },
  ];
  return output;
}

function editableStory(state: NewsroomState, storyId: string, expectedDraftHash?: string): Story {
  const story = state.stories.find(item => item.id === storyId);
  if (!story) throw new Error("Story not found.");
  if (["published", "rejected"].includes(story.status)) throw new Error("This story already has a final decision; create a correction instead.");
  if (["candidate", "researching", "drafting"].includes(story.status)) throw new Error("Research must finish before editorial changes.");
  if (story.draft && (!expectedDraftHash || expectedDraftHash !== story.draft.hash || draftHash(story.draft) !== story.draft.hash)) throw new Error("The draft changed; reload and review the current draft before editing.");
  return story;
}

function retainDraft(story: Story) {
  if (story.draft && !story.draftHistory?.some(draft => draft.hash === story.draft!.hash)) (story.draftHistory ??= []).push(structuredClone(story.draft));
}

function replyScope(draft: ArticleDraft): string {
  const text = (value?: string) => (value ?? "").trim().replace(/\s+/g, " ");
  return JSON.stringify({
    headline: text(draft.headline), deck: text(draft.deck), dateline: text(draft.dateline),
    sentences: draft.sentences.map(sentence => ({ text: text(sentence.text), claimIds: [...new Set(sentence.claimIds)].sort() })),
    captions: (draft.captions ?? []).map(caption => ({ mediaId: caption.mediaId, text: text(caption.text), sourceIds: [...new Set(caption.sourceIds)].sort() })),
  });
}

/** Reply decisions concern the reporting shown to the subject, not access settings or review-note revisions. */
function invalidateChangedReply(state: NewsroomState, story: Story, draft: ArticleDraft, newlyAdverse = false) {
  if (story.editorialTone !== "B" || !story.rightOfReply || story.rightOfReply.status === "requested" || !story.draft) return;
  if (!newlyAdverse && replyScope(story.draft) === replyScope(draft)) return;
  audit(state, "editorial.right_of_reply_invalidated", `The adverse report changed and needs a fresh right-of-reply decision. Previous draft ${story.draft.hash}; previous record: ${JSON.stringify(story.rightOfReply)}`, story.id);
  delete story.rightOfReply;
}

function replaceDraft(state: NewsroomState, story: Story, draft: ArticleDraft, detail: string, newlyAdverse = false) {
  invalidateChangedReply(state, story, draft, newlyAdverse);
  retainDraft(story);
  draft.reviewRevision = (story.draft?.reviewRevision ?? 0) + 1;
  draft.createdAt = now();
  draft.hash = draftHash(draft);
  draft.id = stableId("draft", `${story.id}|${draft.hash}`);
  story.draft = draft;
  story.compliance = checks(state, story);
  transition(state, story, story.compliance.some(check => check.status === "blocked") ? "blocked" : "waiting_approval", detail);
}

/** An explicit owner finding closes a specific question; the model cannot invoke this decision. */
export function resolveStoryGap(state: NewsroomState, storyId: string, gapId: string, input: { note: string; claimIds: string[]; expectedDraftHash?: string }): Story {
  const story = editableStory(state, storyId, input.expectedDraftHash);
  const gap = story.gaps.find(item => item.id === gapId);
  if (!gap || gap.status !== "open") throw new Error("An open evidence gap is required.");
  const note = input.note.trim();
  const claimIds = [...new Set(input.claimIds)];
  if (note.length < 10 || note.length > 3000 || !claimIds.length || claimIds.length > 12 || !claimIds.every(id => verifiedClaim(state, story, id))) throw new Error("Explain how the question is answered and link verified supporting claims from this story.");
  gap.status = "resolved";
  gap.claimIds = claimIds;
  gap.resolution = `James reviewed the linked source evidence: ${note}`;
  audit(state, "editorial.gap_resolved", `James resolved ${gap.id}; supporting claims ${claimIds.join(", ")}. ${note}`, story.id);
  if (story.draft) replaceDraft(state, story, structuredClone(story.draft), "James resolved an evidence question. The revised draft fingerprint and current checks require a fresh publication decision.");
  return story;
}

/** Human-attested prose stays explicitly distinct from machine-verified source quotations. */
export function editStoryDraft(state: NewsroomState, storyId: string, input: { headline: string; sentences: ArticleSentence[]; note: string; humanReviewed: boolean; expectedDraftHash: string; label?: ArticleDraft["label"]; deck?: string; dateline?: string; captions?: ArticleDraft["captions"]; editorialTone?: Story["editorialTone"]; access?: "public" | "members" }): ArticleDraft {
  const story = editableStory(state, storyId, input.expectedDraftHash);
  if (!story.draft) throw new Error("A researched draft is required before editing.");
  const headline = input.headline.trim();
  const note = input.note.trim();
  if (!input.humanReviewed || note.length < 10 || note.length > 3000) throw new Error("James must explicitly attest that the headline and each sentence accurately represent the linked evidence, and record the review.");
  if (headline.length < 5 || headline.length > 160 || !input.sentences.length || input.sentences.length > 40) throw new Error("Provide a headline and between one and 40 sourced paragraphs.");
  const sentences = input.sentences.map(sentence => ({ text: sentence.text.trim(), claimIds: [...new Set(sentence.claimIds)], humanReviewed: true }));
  if (sentences.some(sentence => !sentence.text || sentence.text.length > 4000 || !sentence.claimIds.length || sentence.claimIds.length > 12 || !sentence.claimIds.every(id => verifiedClaim(state, story, id)))) throw new Error("Every paragraph needs verified supporting claims from this story; disputed and private reader assertions cannot be promoted by an edit.");
  if ((input.deck?.length ?? 0) > 600 || (input.dateline?.length ?? 0) > 160 || (input.label && !["opinion", "analysis", "update", "correction", "right_of_reply"].includes(input.label)) || (input.editorialTone && !["A", "B", "N"].includes(input.editorialTone)) || (input.access && !["public", "members"].includes(input.access))) throw new Error("Check the editorial label, deck, dateline, access and internal tone.");
  if (input.captions?.some(caption => !caption.text.trim() || caption.text.length > 600 || !story.media.some(media => media.id === caption.mediaId && media.allowed) || !caption.sourceIds.length || caption.sourceIds.some(id => !story.sourceItems.includes(id)))) throw new Error("Captions need a cleared image and supporting archived sources.");
  const draft = { ...structuredClone(story.draft), headline, sentences, body: sentences.map(sentence => sentence.text).join("\n\n"), factReview: { actor: "James" as const, note, reviewedAt: now() }, ...(input.label !== undefined ? { label: input.label } : {}), ...(input.deck !== undefined ? { deck: input.deck.trim() } : {}), ...(input.dateline !== undefined ? { dateline: input.dateline.trim() } : {}), ...(input.captions !== undefined ? { captions: structuredClone(input.captions) } : {}) };
  if (!quotationBudgetMet(story, draft)) throw new Error("The edited article exceeds the 25-word quotation budget for an archived source. Reduce direct quotations before saving.");
  const newlyAdverse = input.editorialTone === "B" && story.editorialTone !== "B";
  if (input.editorialTone) story.editorialTone = input.editorialTone;
  if (input.access) { draft.access = input.access; story.access = input.access; }
  replaceDraft(state, story, draft, "James saved an evidence-linked narrative and human review attestation. Publication still requires explicit approval of this exact draft.", newlyAdverse);
  audit(state, "editorial.draft_edited", `James reviewed headline and ${sentences.length} paragraph(s); draft ${draft.hash}. ${note}`, story.id);
  return draft;
}

export function recordRightOfReply(state: NewsroomState, storyId: string, input: Omit<NonNullable<Story["rightOfReply"]>, "recordedAt" | "actor"> & { expectedDraftHash: string }): Story {
  const story = editableStory(state, storyId, input.expectedDraftHash);
  if (!story.draft || input.note.trim().length < 10 || input.note.length > 3000 || !["not_required", "requested", "received", "declined", "no_response"].includes(input.status)) throw new Error("Record the right-of-reply decision and editorial reason.");
  if (input.sourceIds.some(id => !story.sourceItems.includes(id) || !state.sourceItems.some(source => source.id === id)) || (["received", "declined"].includes(input.status) && !input.sourceIds.length)) throw new Error("A received or declined response must link its archived evidence; no response content is invented.");
  if (input.status !== "not_required" && (!input.recipient?.trim() || !input.requestedAt || !Number.isFinite(Date.parse(input.requestedAt)))) throw new Error("Record who was contacted and when.");
  if (input.deadline && !Number.isFinite(Date.parse(input.deadline))) throw new Error("Response deadline must be a valid date.");
  if (input.status === "no_response" && (!input.deadline || Date.parse(input.deadline) > Date.now())) throw new Error("The recorded reply deadline must have elapsed before recording no response.");
  const { expectedDraftHash: _expectedDraftHash, ...record } = input;
  story.rightOfReply = { ...structuredClone(record), note: input.note.trim(), actor: "James", recordedAt: now() };
  replaceDraft(state, story, structuredClone(story.draft), "James updated the right-of-reply record; review the refreshed publication package.");
  audit(state, "editorial.right_of_reply", `James recorded ${input.status}. ${input.note.trim()}`, story.id);
  return story;
}

export function createCorrectionStory(state: NewsroomState, publicationId: string, input: { reason: string; sourceIds?: string[]; headline?: string }): Story {
  const publication = state.publications.find(item => item.id === publicationId);
  const original = publication && state.stories.find(item => item.id === publication.storyId);
  if (!publication || !original) throw new Error("Original publication not found.");
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 3000) throw new Error("Describe the published error and the correction needed.");
  const ids = [...new Set(input.sourceIds?.length ? input.sourceIds : original.sourceItems)];
  const items = ids.map(id => state.sourceItems.find(item => item.id === id));
  if (!items.length || items.some(item => !item || (original.mode === "live" && (item.demo || item.url.includes("example.invalid"))))) throw new Error("Correction sources must be archived and use the original publication's mode.");
  const sources = items as SourceItem[];
  const title = input.headline?.trim() || `Correction: ${publication.draft.headline}`;
  if (title.length > 300) throw new Error("Correction title is too long.");
  const createdAt = now();
  const id = stableId("correction", `${publication.id}|${reason}|${state.stories.length}`);
  const story: Story = { id, title, summary: reason, mode: original.mode, status: "candidate", selectedReason: "James requested a correction to an existing publication; the original remains in the audit history.", ...routeStory(sources), sourceItems: ids, claims: [], findings: [], gaps: [], media: [], compliance: [], approvals: [], wagering: original.wagering || isWagering(reason), correctionOf: publication.id, correctionReason: reason, createdAt, updatedAt: createdAt };
  state.stories.push(story);
  addGap(state, story, `Correction review: ${reason}`, 2, true, `correction-${publication.id}`);
  audit(state, "editorial.correction_created", `James requested a correction to ${publication.id}. ${reason}`, story.id);
  return story;
}

/** Withdrawal changes visibility/status metadata, never the approved original snapshot. */
export function setPublicationStatus(state: NewsroomState, publicationId: string, input: { status: "published" | "retracted" | "removed"; note: string }): Publication {
  const publication = state.publications.find(item => item.id === publicationId);
  if (!publication) throw new Error("Publication not found.");
  const note = input.note.trim();
  if (!["published", "retracted", "removed"].includes(input.status) || note.length < 10 || note.length > 3000) throw new Error("Choose a publication status and record the editorial reason.");
  if (draftHash(publication.draft) !== publication.draftHash) throw new Error("The original publication snapshot failed its integrity check.");
  if (input.status === "published" && publication.mode === "live" && !publication.public) throw new Error("A private snapshot cannot be made public through restoration.");
  if ((publication.status ?? "published") === input.status) return publication;
  publication.status = input.status;
  (publication.statusHistory ??= []).push({ status: input.status, note, actor: "James", createdAt: now() });
  audit(state, `publication.${input.status}`, `James changed publication ${publication.id}: ${note}`, publication.storyId);
  return publication;
}

export function setPublicationAccess(state: NewsroomState, publicationId: string, input: { access: "public" | "members"; note: string }): Publication {
  const publication = state.publications.find(item => item.id === publicationId);
  if (!publication || !["public", "members"].includes(input.access) || input.note.trim().length < 10 || input.note.length > 3000) throw new Error("Choose an existing publication, its reader access and an editorial reason.");
  if (publication.mode === "demo" && input.access === "public") throw new Error("Demo publications cannot be exposed as free public samples.");
  publication.access = input.access;
  audit(state, "publication.access_changed", `James set ${publication.id} to ${input.access}: ${input.note.trim()}`, publication.storyId);
  return publication;
}

async function draftStory(state: NewsroomState, story: Story, provider: ResearchProvider, deadline: number) {
  transition(state, story, "drafting", `PE Agent ${story.peAgentId} — ${PE_AGENTS[story.peAgentId - 1].name} — writes from verified Hub claims.`);
  const startedAt = now();
  const claims = story.claims.filter(c => c.status === "verified" && c.verificationScope === "source_statement");
  const sourceWordCounts = new Map<string, number>();
  const quotable = claims.filter(claim => {
    const evidence = claim.evidence.filter(e => e.relation === "supports" && e.exactMatch);
    if (!evidence.length || evidence.some(e => (sourceWordCounts.get(e.sourceId) ?? 0) + e.quote.split(/\s+/).length > BUDGET.maxQuoteWordsPerSource)) return false;
    for (const e of evidence) sourceWordCounts.set(e.sourceId, (sourceWordCounts.get(e.sourceId) ?? 0) + e.quote.split(/\s+/).length);
    return true;
  });
  let sentences = quotable.slice(0, 6).map(c => ({ text: c.text, claimIds: [c.id] }));
  let providerFailed = false;
  if (provider.draft && claims.length && Date.now() < deadline) {
    try {
      const response = await withTimeout(provider.draft({ story: structuredClone(story), sources: structuredClone(sourceItems(state, story)), peAgentId: story.peAgentId }), Math.min(BUDGET.taskTimeoutMs, deadline - Date.now()));
      story.proposedDraft = { ...structuredClone(response), createdAt: now(), status: "requires_human_review" };
      for (const request of (response.researchRequests ?? []).slice(0, 3)) {
        if ([1, 2, 3, 4, 5, 6].includes(request.agentId) && request.question.trim()) addGap(state, story, request.question, request.agentId, true, `editorial-${request.question}`);
      }
      const candidate = response.sentences;
      if (candidate?.length && candidate.length <= 8 && new Set(candidate.flatMap(s => s.claimIds)).size === candidate.length && candidate.every(s => s.claimIds?.length === 1 && quotable.some(c => c.id === s.claimIds[0] && c.text === s.text))) sentences = candidate;
      else audit(state, "editorial.unsupported_draft_rejected", "Provider wording was not a verbatim verified Hub claim. Used the evidence-bound briefing draft.", story.id);
    } catch (error) {
      providerFailed = true;
      audit(state, "editorial.provider_failed", `Used verified-quotation draft after provider error: ${error instanceof Error ? error.message : "unknown error"}`, story.id);
    }
  }
  const limitations = ["This briefing verifies what the cited sources state. It does not independently establish every underlying assertion."];
  if (story.mode === "demo") limitations.unshift("DEMONSTRATION: all people, organisations, events and sources in this package are synthetic.");
  if (story.claims.some(c => c.status !== "verified")) limitations.push("Unverified reader allegations, opinions and inferences are retained in the private research Hub and excluded from this article.");
  if (story.media.some(m => !m.allowed)) limitations.push("Unverified images have been omitted.");
  const draft: ArticleDraft = {
    id: stableId("draft", `${story.id}|${story.approvals.length}|${JSON.stringify(sentences)}`), headline: `${story.mode === "demo" ? "Demo: " : ""}Thoroughbred racing — ${PE_AGENTS[story.peAgentId - 1].name.toLowerCase()} briefing`, byline: `Agent ${story.peAgentId}`, peAgentId: story.peAgentId, sentences, body: sentences.map(s => s.text).join("\n\n"), hash: "", createdAt: now(), limitations, access: story.access ?? "members", ...(story.correctionOf ? { label: "correction" } : {}),
  };
  draft.hash = draftHash(draft);
  invalidateChangedReply(state, story, draft);
  retainDraft(story);
  story.draft = draft;
  state.runs.push({ id: stableId("run", `${draft.id}|editorial|${state.runs.length}`), storyId: story.id, agentType: "editorial", agentId: story.peAgentId, status: providerFailed ? "failed" : "completed", summary: providerFailed ? "PE model request failed. The verified-quotation briefing is retained for private review; the AI editorial stage needs another attempt." : `${sentences.length} evidence-linked sentences; public byline ${draft.byline}.`, startedAt, finishedAt: now() });
}

export async function runNewsroom(state: NewsroomState, input: { mode: "demo" | "live"; items: SourceItem[]; deadline?: number }, provider?: ResearchProvider, checkpoint?: (state: NewsroomState) => Promise<void>, retrieve?: TargetedRetriever): Promise<void> {
  const deadline = Math.min(Date.now() + BUDGET.maxRunMs, input.deadline ?? Infinity);
  const storyBudget = input.mode === "live" ? BUDGET.maxLiveStories : BUDGET.maxStories;
  const researcher = provider ?? (input.mode === "demo" ? demoResearchProvider : recordProvider);
  const save = async () => { if (checkpoint) await checkpoint(state); };
  state.lastRunAt = now();
  audit(state, "newsroom.started", `${input.mode} run; maximum ${storyBudget} stories, ${BUDGET.maxRounds} research rounds and ${BUDGET.retries} retry per task.`);
  const groups = new Map<string, SourceItem[]>();
  // Prioritise newly received records over already ingested inbox history.
  const knownSourceIds = new Set(state.sourceItems.map(item => item.id));
  const incoming = [...input.items].sort((a, b) => Number(knownSourceIds.has(a.id)) - Number(knownSourceIds.has(b.id))).slice(0, 60);
  for (const item of incoming) addSource(state, item, input.mode);
  const assignedSourceIds = new Set(state.stories.flatMap(story => story.sourceItems));
  const backlog = state.sourceItems.filter(item => !assignedSourceIds.has(item.id) && (input.mode === "demo" ? item.demo === true : !item.demo));
  const discoveryItems = [...new Map([...backlog, ...incoming].map(item => [item.id, item])).values()];
  for (const item of discoveryItems) {
    addSource(state, item, input.mode);
    if (!relevant(item) && !(item.isCorrection && item.relatedStoryId)) { audit(state, "discovery.out_of_scope", `Skipped source ${item.id}: no thoroughbred-racing signal.`); continue; }
    const key = normalise(item.title);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const candidates = [...groups.entries()].sort((a, b) => Number(b[1].some(s => s.isCorrection)) - Number(a[1].some(s => s.isCorrection)) || Date.parse(b[1][0].publishedAt) - Date.parse(a[1][0].publishedAt));
  const queue: Story[] = state.stories.filter(s => s.mode === input.mode && ["candidate", "researching", "drafting", "sent_back"].includes(s.status)).slice(0, storyBudget);
  for (const [key, items] of candidates) {
    const id = stableId("story", `${input.mode}|${key}`);
    let story = state.stories.find(s => s.id === id);
    if (story) {
      const hasNewEvidence = items.some(item => !story!.sourceItems.includes(item.id));
      if (hasNewEvidence && story.status === "published") {
        const newIds = items.filter(item => !story!.sourceItems.includes(item.id)).map(item => item.id);
        (story.publishedEvidenceAlerts ??= []).push({ sourceIds: newIds, receivedAt: now(), status: "open" });
        audit(state, "publication.new_evidence", `New archived evidence may affect the published story: ${newIds.join(", ")}. James must review and create a correction or update if required.`, story.id);
      }
      if (hasNewEvidence && !["published", "rejected"].includes(story.status) && queue.length >= storyBudget && !queue.includes(story)) {
        audit(state, "selection.deferred", `New evidence for ${story.id} remains in the persistent source backlog until research capacity is available.`, story.id);
        if (story.status === "waiting_approval") transition(state, story, "candidate", "The previous approval package is paused until newly received evidence has been researched.");
        continue;
      }
      for (const item of items) if (!story.sourceItems.includes(item.id)) story.sourceItems.push(item.id);
      audit(state, "discovery.duplicate", `Existing story ${id} retained; original sources preserved.`, id);
      if (hasNewEvidence && !["published", "rejected"].includes(story.status) && !queue.includes(story)) {
        transition(state, story, "candidate", "New archived evidence requires a refreshed research and approval package.");
        queue.push(story);
      }
      continue;
    }
    if (queue.length >= storyBudget) { audit(state, "selection.deferred", `Deferred ${items[0].title}: per-run story budget reached.`); continue; }
    const route = routeStory(items);
    const correctionOf = items.find(i => i.relatedStoryId)?.relatedStoryId;
    story = { id, title: items[0].title, summary: items[0].content.slice(0, 280), mode: input.mode, status: "candidate", selectedReason: `${items.some(i => i.isCorrection) ? "Reader correction receives priority. " : ""}Relevant thoroughbred-racing lead with ${items.length} archived source(s); assigned multiple research disciplines for primary-record verification and context.`, ...route, sourceItems: items.map(i => i.id), claims: [], findings: [], gaps: [], media: items.flatMap(i => i.media ?? []).map(m => ({ ...structuredClone(m), allowed: false })), compliance: [], approvals: [], wagering: isWagering(items.map(i => `${i.title} ${i.content}`).join(" ")), ...(correctionOf ? { correctionOf } : {}), createdAt: now(), updatedAt: now() };
    state.stories.push(story);
    queue.push(story);
    audit(state, "discovery.candidate_created", story.selectedReason, story.id);
    await save();
  }
  // New candidates get their turn before retrying old infrastructure failures.
  const retryable = state.stories.filter(story => story.mode === input.mode && story.status === "blocked" && story.gaps.some(gap => gap.status === "open" && operationalGap(state, story, gap))).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  for (const story of retryable) if (queue.length < storyBudget && !queue.includes(story)) queue.push(story);
  for (const story of queue) {
    try {
      if (Date.now() >= deadline) {
        addGap(state, story, "Whole-run time budget was exhausted before this story could complete. Resume research in a later run.", 2, true, "wall-clock-budget");
        transition(state, story, "blocked", "Whole-run time budget exhausted; evidence remains unresolved.");
        await save();
        continue;
      }
      const wasSentBack = story.status === "sent_back";
      transition(state, story, "researching", wasSentBack ? "James's revision request returns to the research controller." : "Story selected; specialist research commissioned.");
      await save();
      const requests = wasSentBack ? story.gaps.filter(g => g.status === "open" && g.blocking).map(g => ({ agentId: g.agentId, question: g.question })) : story.researchAgentIds.map(agentId => ({ agentId, question: `${RESEARCH_AGENTS[agentId - 1].description} Investigate this specific racing lead, preserve exact passages and identify unknowns.` }));
      const uniqueRequests = [...new Map(requests.map(request => [`${request.agentId}|${request.question}`, request])).values()];
      await mapBounded(uniqueRequests, GATEWAY_PACING.maxConcurrent, r => researchTask(state, story, r.agentId, 0, r.question, researcher, deadline));
      assess(state, story);
      await save();
      // Drafting may itself identify missing evidence; those requests share the same bounded loop.
      await draftStory(state, story, researcher, deadline);
      await save();
      const followups = [...new Map(story.gaps.filter(g => g.status === "open").map(gap => [`${gap.agentId}|${gap.question}`, gap])).values()].slice(0, 6);
      if (followups.length) {
        if (retrieve && input.mode === "live" && Date.now() < deadline) {
          const retrievalDeadline = Math.min(deadline, Date.now() + BUDGET.retrievalTimeoutMs);
          try {
            const result = await withTimeout(retrieve({ story: structuredClone(story), questions: followups.map(gap => gap.question), sourceItems: structuredClone(sourceItems(state, story)), maxItems: BUDGET.maxAdditionalSources, deadline: retrievalDeadline }), Math.max(1, retrievalDeadline - Date.now()));
            const newItems = result.items.filter(item => !story.sourceItems.includes(item.id)).slice(0, BUDGET.maxAdditionalSources);
            for (const item of newItems) { addSource(state, item, input.mode); story.sourceItems.push(item.id); }
            for (const error of result.errors ?? []) audit(state, "retrieval.source_failed", `${error.sourceId}: ${error.message}`, story.id);
            audit(state, "retrieval.completed", `${newItems.length} additional registered-source item(s) archived for targeted evidence questions.`, story.id);
          } catch (error) {
            audit(state, "retrieval.failed", error instanceof Error ? error.message : "Targeted collection failed; unresolved questions remain open.", story.id);
          }
          await save();
        }
        transition(state, story, "researching", `${followups.length} targeted gap(s) returned to the appropriate research agents.`);
        await save();
        await mapBounded(followups, GATEWAY_PACING.maxConcurrent, g => researchTask(state, story, g.agentId, 1, g.question, researcher, deadline));
        assess(state, story);
        await save();
        await draftStory(state, story, researcher, deadline);
      }
      story.compliance = checks(state, story);
      const blocked = story.compliance.some(c => c.status === "blocked");
      transition(state, story, blocked ? "blocked" : "waiting_approval", blocked ? "Research/compliance budget ended with explicit unresolved blockers. Nothing is published." : "Complete approval package prepared. Publication awaits James's explicit decision.");
      await save();
    } catch (error) {
      story.error = error instanceof Error ? error.message : "Unexpected newsroom failure.";
      transition(state, story, "blocked", story.error);
      await save();
    }
  }
  audit(state, "newsroom.completed", `${queue.length} story package(s) processed; publication remains a separate human action.`);
  await save();
}

export function decideStory(state: NewsroomState, storyId: string, decision: "approve" | "reject" | "send_back", note: string, wageringAcknowledged: boolean): void {
  const story = state.stories.find(s => s.id === storyId);
  if (!story) throw new Error("Story not found.");
  if (!["approve", "reject", "send_back"].includes(decision)) throw new Error("Invalid approval decision.");
  if (["published", "rejected"].includes(story.status)) throw new Error("This story already has a final decision; create a correction instead.");
  if (["candidate", "researching", "drafting"].includes(story.status)) throw new Error("Research must finish before James can decide.");
  if (decision === "approve") {
    if (story.status !== "waiting_approval" || !story.draft) throw new Error("Only a complete package waiting for approval can be published.");
    if (draftHash(story.draft) !== story.draft.hash) throw new Error("Draft changed after checks; rerun review before approval.");
    story.compliance = checks(state, story);
    if (story.compliance.some(c => c.status === "blocked")) throw new Error("Publication blocked by current evidence or compliance checks.");
    if (story.wagering && !wageringAcknowledged) throw new Error("James must explicitly acknowledge wagering review.");
    if (story.mode === "live" && sourceItems(state, story).some(s => s.demo || s.url.includes("example.invalid"))) throw new Error("Demo evidence cannot enter a public publication.");
  }
  const createdAt = now();
  story.approvals.push({ id: stableId("approval", `${story.id}|${story.approvals.length}|${decision}`), decision, note: note.slice(0, 3000), actor: "James", draftHash: story.draft?.hash ?? null, wageringAcknowledged, createdAt });
  audit(state, `approval.${decision}`, note || `James selected ${decision}.`, story.id);
  if (decision === "approve" && story.draft) {
    state.publications.push({ id: stableId("publication", `${story.id}|${story.draft.hash}`), storyId: story.id, mode: story.mode, public: story.mode === "live", draftHash: story.draft.hash, draft: structuredClone(story.draft), approvedBy: "James", approvedAt: createdAt, publishedAt: createdAt, status: "published", access: story.draft.access ?? "members", ...(story.correctionOf ? { correctionOf: story.correctionOf, correctionReason: story.correctionReason } : {}) });
    transition(state, story, "published", story.mode === "demo" ? "Private demo publication simulated after James's approval." : "Exact approved article snapshot published after James's approval.");
  } else if (decision === "reject") transition(state, story, "rejected", "James rejected this package.");
  else if (decision === "send_back") {
    addGap(state, story, `James requests: ${note.trim() || "Review the evidence and prepare a revised package."}`, 2, true, `james-${story.approvals.length}`);
    transition(state, story, "sent_back", "James's note entered the targeted research queue. Unresolved instructions will remain visible.");
  }
}

/** Separate form feature: no fabricated runners or certainty, and no route around wagering review. */
export function analyseForm(runners: FormRunner[], sources: SourceItem[]): FormAnalysis {
  const createdAt = now();
  const complete = runners.filter(r => r.horse && r.form && r.class && r.track && r.going && r.jockey && r.trainer && r.trials && r.barrier > 0 && r.distance > 0 && r.weight > 0 && r.sourceIds.length && r.sourceIds.every(id => sources.some(s => s.id === id && ["official", "data"].includes(s.type))));
  if (complete.length < 3) return { id: stableId("form", JSON.stringify(runners)), status: "blocked", selections: [], limitations: ["At least three runners need sourced form, class, barrier, distance, track, going, weight, jockey, trainer and trial data.", "No selections are invented from incomplete evidence."], createdAt };
  // Input order is the operator/provider's researched shortlist, never an unsupported probability model.
  const tiers = ["higher confidence", "medium confidence", "speculative/high-risk"] as const;
  return { id: stableId("form", JSON.stringify(runners)), status: "ready_for_review", selections: complete.slice(0, 3).map((runner, index) => ({ horse: runner.horse, tier: tiers[index], analysis: `${runner.horse}: supplied form ${runner.form}; ${runner.class}, ${runner.distance}m at ${runner.track}, ${runner.going}; barrier ${runner.barrier}, ${runner.weight}kg; ${runner.jockey} for ${runner.trainer}. Trials: ${runner.trials}. These are supplied inputs, not a predicted result.`, sourceIds: runner.sourceIds })), limitations: ["The three tiers preserve the supplied shortlist order; they are editorial risk labels, not measured probabilities or betting recommendations.", "Recheck official late changes and source freshness. Wagering policy review and James's explicit approval are required before any publication."], createdAt };
}
