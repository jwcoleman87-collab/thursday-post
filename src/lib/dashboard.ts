import { readStore, type StoreData } from './store';
import { readDocument } from './durable-store';
import { autoPublishHold } from './engine';
import { liveProviderConfigured } from './providers';
import type { Story, NewsroomState } from './domain';
import type { RunRecord } from './operations';

/**
 * The owner home screen in plain English: is the paper running, what are the agents doing,
 * and what (if anything) needs James. Everything here is derived from the newsroom record;
 * nothing is written.
 */
export type Tone = 'good' | 'working' | 'attention' | 'paused';
export interface NeedsYouItem { storyId: string; headline: string; reason: string; action: 'approve' | 'review'; draftHash?: string; wagering: boolean; paragraphs: string[]; sources: { title: string; url: string }[]; writer: string }
export interface InProgressItem { storyId: string; title: string; stage: string; step: number; detail: string; updatedAt: string; stuck: boolean }
export interface PublishedItem { id: string; headline: string; publishedAt: string; section: string; automatic: boolean }
export interface SetupItem { title: string; fix: string }
export interface ActivityItem { at: string; text: string }
export interface Dashboard {
  status: { tone: Tone; title: string; detail: string };
  settings: { autoPublish: boolean; monitoring: boolean; aiReady: boolean; agentsReady: boolean; running: boolean };
  lastRun: { at: string; ok: boolean; text: string } | null;
  counts: { publishedThisWeek: number; inProgress: number; needsYou: number; sourcesEnabled: number };
  needsYou: NeedsYouItem[];
  setup: SetupItem[];
  inProgress: InProgressItem[];
  published: PublishedItem[];
  activity: ActivityItem[];
}

export const SECTIONS = ['Integrity & Governance', 'People & Stables', 'Business & Bloodstock', 'International'] as const;
export const sectionFor = (peAgentId: number) => SECTIONS[(peAgentId - 1) % 4];

/** Steps shown as a 4-stage progress bar: find → research → write → check. */
function stageOf(state: NewsroomState, story: Story): Omit<InProgressItem, 'storyId' | 'title' | 'updatedAt'> {
  const phase = story.autonomy?.phase;
  const openQuestions = story.gaps.filter(g => g.status === 'open' && g.blocking).length;
  if (story.status === 'sent_back') return { stage: 'Back with the researchers', step: 2, detail: 'Following up on your note.', stuck: false };
  if (story.status === 'candidate') return { stage: 'Lead found', step: 1, detail: 'Queued for the research team on the next run.', stuck: false };
  if (story.status === 'researching' || story.status === 'drafting') return { stage: 'Researching', step: 2, detail: 'Research agents are reading the sources right now.', stuck: false };
  if (phase === 'compose') return { stage: 'Writing', step: 3, detail: story.autonomy?.attempts ? 'Writer is fixing the problems the checker found.' : 'Research done. A writer picks it up on the next run.', stuck: false };
  if (phase === 'review') return { stage: 'Being checked', step: 4, detail: 'A second agent is checking every sentence against the sources.', stuck: false };
  if (phase === 'held') {
    const why = story.autonomy?.feedback[0];
    return { stage: 'Stuck', step: 4, detail: `The checker could not back this story up after two tries${why ? `: “${why.slice(0, 160)}”` : '.'} It will retry automatically if new sources arrive.`, stuck: true };
  }
  if (story.error) return { stage: 'Stuck', step: 2, detail: plainError(story.error), stuck: true };
  if (openQuestions) return { stage: 'Researching', step: 2, detail: `${openQuestions} question${openQuestions === 1 ? '' : 's'} still being researched. Continues on the next run.`, stuck: false };
  return { stage: 'Queued', step: 2, detail: 'Continues on the next run.', stuck: false };
}

function plainError(message: string): string {
  if (/rate limit/i.test(message)) return 'The AI service asked us to slow down. It will retry on the next run.';
  if (/credits|budget/i.test(message)) return 'The AI account is out of credit. Top up in Vercel → AI Gateway.';
  if (/verification/i.test(message)) return 'The AI account needs verifying in Vercel → AI Gateway.';
  if (/time budget|timed out|deadline/i.test(message)) return 'Ran out of time on the last run. It picks up where it left off.';
  return message.length > 180 ? message.slice(0, 177) + '…' : message;
}

const ACTIVITY: Record<string, (detail: string) => string | null> = {
  'run_started': () => 'Agents woke up and started a run.',
  'run_finished': () => 'Run finished.',
  'run_failed': detail => `Run stopped early: ${plainError(detail)}`,
  'collection_finished': detail => detail.split('.')[0] + '.',
  'discovery.candidate_created': () => 'Found a new story lead.',
  'autonomy.editorial_checked': () => 'Checker passed an article.',
  'autonomy.revision_required': () => 'Checker sent an article back to the writer.',
  'approval.approve': detail => /standing instruction/.test(detail) ? 'Published an article automatically.' : 'You published an article.',
  'approval.reject': () => 'You rejected an article.',
  'approval.send_back': () => 'You sent an article back for more work.',
  'monitoring_updated': detail => /enabled/.test(detail) ? 'Automatic runs switched on.' : 'Automatic runs paused.',
  'autopublish_updated': detail => detail,
};

function translateActivity(state: NewsroomState): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (let i = state.audit.length - 1; i >= 0 && out.length < 12; i--) {
    const entry = state.audit[i];
    const text = ACTIVITY[entry.action]?.(entry.detail);
    if (text && out.at(-1)?.text !== text) out.push({ at: entry.createdAt, text });
  }
  return out;
}

function runText(run: RunRecord): string {
  const kind = run.mode === 'collect' ? 'Collected sources (AI paused)' : 'Research run';
  if (run.status === 'completed') return `${kind} completed`;
  if (run.status === 'running') return `${kind} in progress`;
  if (run.status === 'interrupted') return `${kind} was cut off; the next run resumes it`;
  return `${kind} failed: ${run.error ?? 'see the detailed newsroom'}`;
}

export function dashboardFrom(data: StoreData, runs: RunRecord[], now = Date.now()): Dashboard {
  const { state } = data;
  const live = state.stories.filter(s => s.mode === 'live');
  const autoPublish = data.autoPublish !== false;
  const aiReady = process.env.NEWSROOM_AI_PAUSED !== 'true' && liveProviderConfigured();
  const agentsReady = process.env.NEWSROOM_AUTONOMOUS_AGENTS === 'true';
  const running = Boolean(data.lease && Date.parse(data.lease.expiresAt) > now);
  const sourcesEnabled = data.sources.filter(s => s.enabled).length;

  const setup: SetupItem[] = [];
  if (process.env.NEWSROOM_AI_PAUSED === 'true') setup.push({ title: 'The AI writers are switched off', fix: 'In Vercel → the-racing-desk → Settings → Environment Variables, set NEWSROOM_AI_PAUSED to false, then redeploy.' });
  else if (!liveProviderConfigured()) setup.push({ title: 'No AI model is connected', fix: 'Set NEWSROOM_MODEL (e.g. openai/gpt-4.1-mini) in Vercel environment variables.' });
  if (!agentsReady) setup.push({ title: 'The writer and checker agents are switched off', fix: 'Set NEWSROOM_AUTONOMOUS_AGENTS to true in Vercel environment variables, then redeploy.' });
  if (!data.monitoring) setup.push({ title: 'Automatic runs are paused', fix: 'Use the “Automatic runs” switch on this page.' });
  if (!sourcesEnabled) setup.push({ title: 'No news sources are switched on', fix: 'Open the detailed newsroom → Settings and enable Racing NSW, Racing Victoria and Racing Queensland.' });
  const lastLive = runs.filter(r => r.mode !== 'demo').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (lastLive?.errorCode === 'provider_budget') setup.push({ title: 'The AI account is out of credit', fix: 'Top up credit in Vercel → AI Gateway. Runs resume automatically.' });
  if (lastLive?.errorCode === 'account_verification' || lastLive?.errorCode === 'access_denied') setup.push({ title: 'The AI account is refusing requests', fix: 'Open Vercel → AI Gateway and finish account verification (add a card).' });

  const needsYou: NeedsYouItem[] = [];
  const inProgress: InProgressItem[] = [];
  for (const story of live) {
    if (['published', 'rejected'].includes(story.status)) continue;
    if (story.status === 'waiting_approval' && story.draft) {
      const reason = autoPublish ? (autoPublishHold(state, story) ?? 'Ready. Publishes automatically on the next run.') : 'Ready for your OK.';
      const ids = new Set(story.claims.filter(c => story.draft!.sentences.some(s => s.claimIds.includes(c.id))).flatMap(c => c.evidence.map(e => e.sourceId)));
      needsYou.push({ storyId: story.id, headline: story.draft.headline, reason, action: 'approve', draftHash: story.draft.hash, wagering: story.wagering, paragraphs: story.draft.sentences.map(s => s.text), sources: state.sourceItems.filter(s => ids.has(s.id) && s.url.startsWith('https://')).map(s => ({ title: s.title, url: s.url })).slice(0, 6), writer: `Agent ${story.peAgentId}` });
      continue;
    }
    if (story.status === 'blocked' && story.editorialTone === 'B' && story.rightOfReply === undefined && story.draft?.assessorReview && story.autonomy?.phase !== 'held') {
      needsYou.push({ storyId: story.id, headline: story.draft.headline, reason: 'Critical of a named person or organisation. Record whether they were asked for comment (detailed newsroom → Right of reply), then approve.', action: 'review', wagering: story.wagering, paragraphs: story.draft.sentences.map(s => s.text), sources: [], writer: `Agent ${story.peAgentId}` });
      continue;
    }
    inProgress.push({ storyId: story.id, title: (story.draft?.assessorReview && story.draft.headline) || story.autonomy?.proposal?.headline.text || story.title, updatedAt: story.updatedAt, ...stageOf(state, story) });
  }
  inProgress.sort((a, b) => Number(a.stuck) - Number(b.stuck) || b.updatedAt.localeCompare(a.updatedAt));

  const weekAgo = now - 7 * 86_400_000;
  const publications = state.publications.filter(p => p.mode === 'live' && p.public && p.status !== 'removed').sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const published: PublishedItem[] = publications.slice(0, 8).map(p => ({ id: p.id, headline: p.draft.headline, publishedAt: p.publishedAt, section: sectionFor(p.draft.peAgentId), automatic: Boolean(state.stories.find(s => s.id === p.storyId)?.approvals.some(a => a.decision === 'approve' && /standing instruction/.test(a.note))) }));
  const publishedThisWeek = publications.filter(p => Date.parse(p.publishedAt) >= weekAgo).length;

  const lastRun = lastLive ? { at: lastLive.startedAt, ok: lastLive.status === 'completed' || lastLive.status === 'running', text: runText(lastLive) } : null;
  const hardSetup = setup.filter(s => !/paused/.test(s.title) || !data.monitoring);
  let status: Dashboard['status'];
  if (running) status = { tone: 'working', title: 'The agents are working right now', detail: 'A run is in progress. This page refreshes itself.' };
  else if (!data.monitoring) status = { tone: 'paused', title: 'The paper is paused', detail: 'Automatic runs are off. Switch them on below, or press “Run the agents now”.' };
  else if (hardSetup.length) status = { tone: 'attention', title: `${hardSetup.length === 1 ? 'One thing is' : `${hardSetup.length} things are`} stopping the paper`, detail: hardSetup[0].title + '. The fix is below.' };
  else if (needsYou.some(n => !/Publishes automatically/.test(n.reason))) status = { tone: 'attention', title: `The paper is running. ${needsYou.length === 1 ? 'One article needs' : `${needsYou.length} articles need`} you`, detail: autoPublish ? 'Everything else is publishing on its own.' : 'Automatic publishing is off, so every article waits for your OK.' };
  else status = { tone: 'good', title: 'The paper is running on its own', detail: `${publishedThisWeek} article${publishedThisWeek === 1 ? '' : 's'} published in the last 7 days. ${inProgress.length} in the works.` };

  return {
    status,
    settings: { autoPublish, monitoring: data.monitoring, aiReady, agentsReady, running },
    lastRun,
    counts: { publishedThisWeek, inProgress: inProgress.length, needsYou: needsYou.length, sourcesEnabled },
    needsYou, setup, inProgress: inProgress.slice(0, 12), published, activity: translateActivity(state),
  };
}

export async function buildDashboard(): Promise<Dashboard> {
  const data = await readStore();
  const ops = await readDocument<{ runs: RunRecord[] }>('newsroom-operations', () => ({ runs: [] }));
  return dashboardFrom(data, ops.runs ?? []);
}

