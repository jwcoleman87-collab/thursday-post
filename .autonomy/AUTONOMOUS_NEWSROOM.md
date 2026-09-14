# Autonomous newsroom: researchers and PE desks, not a browser operator

The server-controlled live run can complete the research-to-editorial handoff itself. Enable `NEWSROOM_AUTONOMOUS_AGENTS=true` only after code review and production acceptance. This is separate from operator-only `assessed_draft` and `scope_assessment` switches. A request body cannot enable this mode or grant model tool access.

The existing scheduled `/api/cron` route and owner GO both call `startRun`; that method selects the autonomous path from server configuration. Monitoring and AI-pause settings remain authoritative. The existing daily schedule, registered source list, model, monetary settings, one-story/two-research-task limits and publication/SEND controls are unchanged.

## Shared workflow

1. Collect registered sources through existing guarded adapters. Previously unfinished work and corrections retain their priority. Targeted retrieval for stored questions now works across invocations with the real one-round live setting.
2. Relevant members of the six research disciplines contribute findings. Completed requests against the same evidence version are not repeated. Incomplete required commissions defer editorial spending.
3. The assigned one of four PE desks produces complete original wording with exact archived passages for its headline and paragraphs. It receives the target Thursday issue date and current timestamp; a pre-race source is not a race result.
4. A different PE desk checks every field in a separate model invocation against the same bounded sources. Unsupported or incomplete wording and wrong temporal framing return to the writer. Actual indispensable missing evidence returns to the researchers. There are bounded revision attempts rather than unlimited model loops.
5. Only the server controller validates and records the checked result using the existing source-linked draft mechanism. Model judgement is explicitly automated editorial review, not proof of underlying assertions or James's personal fact review. Missing primary evidence, owner decisions, contradictions, reply obligations and wagering are not waived.
6. Agent-created extra questions may receive a separately recorded scope assessment only if the checking PE reviewed the actual article and supplied relevant evidence. The original question stays open when it is merely optional. Source-backed answers to agent-created questions are recorded separately as automated judgements.
7. A complete valid article reaches `waiting_approval`. The private next-issue proof displays full paragraphs. No article or issue is automatically published or sent.

## Recovery and costs

A persisted per-story phase and writer proposal survive invocation boundaries. The next invocation resumes the checking stage rather than paying to rewrite a completed proposal. Changed draft/evidence or issue context invalidate checkpoints. No-progress review is held with explicit reasons; other stories can proceed.

The gateway allows at most four actual dispatches per autonomous invocation, INCLUDING preflight, research, writing, checking and retries. Existing research-task limit remains two. A writer can therefore finish in one invocation and its checker in the next. Usage records retain each real completed request. Gateway pacing and full provider Retry-After deadlines are persisted to the newsroom store; a new invocation does not forget them. Existing backup validation includes the new optional checkpoint/cooldown fields.

The existing daily cadence is intentionally not increased blindly. The actual hosting plan and provider limits must be checked before changing cadence. Vercel Hobby supports daily cron only; a faster allowed cadence or separately authorised scheduler may be needed for a full weekly edition. Do not work around account restrictions or increase spending merely to claim autonomy.

## Acceptance (not satisfied by unit tests alone)

Run the signed scheduled workflow with real authorised sources/model, no owner browser and no editorial operator POST. Observe required researcher outputs, an assigned PE writer, a separate checking PE, persisted recovery after a bounded stop, and a complete source-linked article in both owner views. Check a genuine missing-evidence case remains blocked and a date-sensitive preview is not promoted as an outcome. Verify no personal review, publication or SEND was fabricated. The four PE desks and six researcher roles are covered by automated fixtures, not necessarily all relevant to every real story.

Full weekly operation additionally requires enough permitted scheduled invocations to prepare an edition, source/image coverage, private complete issue proof and the separately approved real delivery integration. This change does not claim those production/account steps have happened.
