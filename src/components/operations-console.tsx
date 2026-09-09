'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { CommerceReadiness, CommerceSettings } from '@/lib/commerce-types';
import type { Publication } from '@/lib/domain';
import type { DeliveryJob, NewspaperEdition } from '@/lib/edition-types';
import type { RunRecord } from '@/lib/operations';

type ReadinessCheck = { name: string; ready: boolean; detail: string };
type Newsroom = { state: { publications: Publication[] }; config: { running: boolean; readiness: ReadinessCheck[] } };
type EditionData = {
  editions: NewspaperEdition[];
  publications: { id: string; headline: string; byline: string; publishedAt: string }[];
  delivery: { configured: boolean; counts: Record<string, number>; campaigns: { editionId: string; queuedAt: number; recipients: number }[]; jobs: Omit<DeliveryJob, 'payload' | 'lease'>[] };
};
type BillingData = { settings: CommerceSettings; readiness: CommerceReadiness; memberCount: number; paidMemberCount: number };
type Health = {
  status: 'attention' | 'healthy' | 'paused';
  monitoring: boolean;
  aiPaused: boolean;
  eligibleDeliveryRecipients: number;
  issues: { code: string; message: string; severity: string }[];
  totals: { started: number; completed: number; failed: number; interrupted: number; inputTokens: number; outputTokens: number; estimatedKnownCostUsd: number; unpricedRuns: number };
  latestLiveRunAt?: string;
  runs: RunRecord[];
  staleRunIds: string[];
  ownerAlertsConfigured: boolean;
  alerts: { runId: string; status: 'sending' | 'sent' | 'failed' | 'unknown'; createdAt: string; finishedAt?: string }[];
  costNote: string;
};
type DraftFields = { number: number; date: string; title: string; preview: string; publicationIds: string[] };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
const initialDraft = (): DraftFields => ({ number: 1, date: today(), title: '', preview: '', publicationIds: [] });
const dateLabel = (value: string | number) => new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });
const statusLabel: Record<string, string> = { pending: 'Queued', sending: 'Sending', sent: 'Accepted by email provider', delivered: 'Delivered', suppressed: 'Email stopped', failed: 'Needs attention', cancelled: 'Cancelled after editorial change' };

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function api<T>(url: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(url, { method: options.method ?? 'GET', headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: options.body === undefined ? undefined : JSON.stringify(options.body), cache: 'no-store', signal: options.signal });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(result.error || 'The request could not be completed. Please try again.', response.status);
  return result as T;
}

export default function OperationsConsole() {
  const [newsroom, setNewsroom] = useState<Newsroom>();
  const [editionData, setEditionData] = useState<EditionData>();
  const [billing, setBilling] = useState<BillingData>();
  const [health, setHealth] = useState<Health>();
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fields, setFields] = useState<DraftFields>(initialDraft);
  const [editing, setEditing] = useState<{ id: string; hash: string }>();
  const [selectedEditionId, setSelectedEditionId] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState('');
  const [sendConfirmed, setSendConfirmed] = useState('');
  const [priceId, setPriceId] = useState('');
  const [salesEnabled, setSalesEnabled] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const results = await Promise.all([
      api<Newsroom>('/api/newsroom', { signal }),
      api<EditionData>('/api/owner/editions', { signal }),
      api<BillingData>('/api/billing/settings', { signal }),
      api<Health>('/api/owner/operations', { signal }).catch(reason => { if ((reason instanceof ApiError && reason.status === 401) || signal?.aborted) throw reason; return undefined; }),
    ]);
    if (signal?.aborted) return;
    setNewsroom(results[0]); setEditionData(results[1]); setBilling(results[2]); setHealth(results[3]);
    setFields(current => current.title || current.publicationIds.length ? current : { ...current, number: Math.max(0, ...results[1].editions.map(edition => edition.number)) + 1 });
    setPriceId(results[2].settings.priceId ?? ''); setSalesEnabled(results[2].settings.liveSalesEnabled);
    setNeedsLogin(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(reason => { if (controller.signal.aborted) return; if (reason instanceof ApiError && reason.status === 401) setNeedsLogin(true); else setError(reason instanceof Error ? reason.message : 'The publishing desk could not be opened.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  async function action(name: string, work: () => Promise<string | void>) {
    setBusy(name); setError(''); setNotice('');
    try { const message = await work(); await load(); if (message) setNotice(message); }
    catch (reason) { if (reason instanceof ApiError && reason.status === 401) setNeedsLogin(true); setError(reason instanceof Error ? reason.message : 'The change could not be saved.'); }
    finally { setBusy(''); }
  }

  const selectedEdition = editionData?.editions.find(edition => edition.id === selectedEditionId);
  const campaign = editionData?.delivery.campaigns.find(item => item.editionId === selectedEditionId);
  const selectedJobs = editionData?.delivery.jobs.filter(job => job.editionId === selectedEditionId) ?? [];
  const selectedCounts = Object.fromEntries(Object.keys(statusLabel).map(status => [status, selectedJobs.filter(job => job.status === status).length]));
  const eligibleCount = health?.eligibleDeliveryRecipients;
  const disabled = Boolean(busy) || Boolean(newsroom?.config.running);

  function newDraft() {
    setEditing(undefined); setFields({ ...initialDraft(), number: Math.max(0, ...(editionData?.editions.map(edition => edition.number) ?? [])) + 1 });
    setNotice('Prepare the edition below, then save it for a final review.'); setError('');
  }
  function editDraft(edition: NewspaperEdition) {
    setFields({ number: edition.number, date: edition.date, title: edition.title, preview: edition.preview, publicationIds: edition.articles.map(article => article.publicationId) });
    setEditing({ id: edition.id, hash: edition.reviewHash }); setSelectedEditionId(edition.id); setReviewConfirmed(''); setSendConfirmed('');
  }
  function moveArticle(id: string, direction: number) {
    setFields(current => {
      const ids = [...current.publicationIds]; const index = ids.indexOf(id); const next = index + direction;
      if (index < 0 || next < 0 || next >= ids.length) return current;
      [ids[index], ids[next]] = [ids[next], ids[index]];
      return { ...current, publicationIds: ids };
    });
  }
  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields.publicationIds.length) { setError('Choose at least one approved article for this edition.'); return; }
    await action('draft', async () => {
      const result = await api<{ edition: NewspaperEdition }>(editing ? `/api/owner/editions/${editing.id}` : '/api/owner/editions', { method: editing ? 'PATCH' : 'POST', body: { ...fields, ...(editing ? { expectedReviewHash: editing.hash } : {}) } });
      setEditing({ id: result.edition.id, hash: result.edition.reviewHash }); setSelectedEditionId(result.edition.id); setReviewConfirmed(''); setSendConfirmed('');
      return 'Draft saved. Review the edition and its free preview before releasing it.';
    });
  }

  if (loading) return <main className="operations"><p role="status">Opening the publishing desk…</p></main>;
  if (needsLogin) return <main className="operations"><h1>The editor’s publishing desk</h1><p>Sign in as the owner to manage editions, subscriptions and delivery.</p><Link className="button primary" href="/login">Sign in to the newsroom</Link></main>;
  if (!editionData || !billing || !newsroom) return <main className="operations"><h1>Publishing &amp; operations</h1><p role="alert">{error || 'The publishing desk is unavailable.'}</p><button className="button primary" disabled={Boolean(busy)} onClick={() => void action('refresh', async () => { await load(); })}>Try again</button><p><Link href="/newsroom">Back to the newsroom</Link></p></main>;

  return <main className="operations">
    <nav aria-label="Owner navigation"><Link href="/newsroom">Research newsroom</Link><Link href="/">Read the paper</Link><Link href="/editions">Edition archive</Link></nav>
    <header><p className="eyebrow">The Thursday Post · Owner</p><h1>Publishing &amp; operations</h1><p>Prepare the paper, release a reviewed edition, then send it to your readers.</p></header>
    <div className="operations-row"><a href="#edition-builder">Prepare an edition</a><a href="#edition-review">Review &amp; delivery</a><a href="#subscriptions">Subscriptions</a><a href="#published-stories">Published stories</a><a href="#health">Service health</a><button className="button secondary" disabled={Boolean(busy)} onClick={() => void action('refresh', async () => 'The publishing desk is up to date.')}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh status'}</button></div>
    {error ? <p className="notice danger" role="alert">{error}</p> : null}
    {notice ? <p className="notice" role="status">{notice}</p> : null}
    {newsroom.config.running ? <p className="notice">A research cycle is running. Editorial changes will be available when it finishes.</p> : null}

    <section className="operations-section" id="edition-builder" aria-labelledby="builder-heading">
      <div className="operations-row"><h2 id="builder-heading">{editing ? 'Edit the draft edition' : 'Prepare an edition'}</h2><button className="button secondary" type="button" disabled={disabled} onClick={newDraft}>Start a new edition</button></div>
      {!editionData.publications.length ? <p>No approved live articles are ready for an edition. Review and approve reporting in the <Link href="/newsroom">newsroom</Link> first.</p> : null}
      <form onSubmit={saveDraft}>
        <div className="operations-row"><label>Edition number<input type="number" min={1} max={99999} required value={fields.number} onChange={event => setFields(current => ({ ...current, number: Number(event.target.value) }))} /></label><label>Edition date<input type="date" required value={fields.date} onChange={event => setFields(current => ({ ...current, date: event.target.value }))} /></label></div>
        <label>Edition title<input required maxLength={180} placeholder="The week in Australian racing" value={fields.title} onChange={event => setFields(current => ({ ...current, title: event.target.value }))} /></label>
        <label>Free preview<textarea required rows={3} maxLength={1500} placeholder="A short introduction that every visitor can read." value={fields.preview} onChange={event => setFields(current => ({ ...current, preview: event.target.value }))} /></label>
        <p>This preview is public. The articles in the edition require a paid membership.</p>
        <fieldset><legend>Choose approved articles</legend>{editionData.publications.map(publication => <label className="operations-row" key={publication.id}><input type="checkbox" checked={fields.publicationIds.includes(publication.id)} onChange={event => setFields(current => ({ ...current, publicationIds: event.target.checked ? [...current.publicationIds, publication.id] : current.publicationIds.filter(id => id !== publication.id) }))} /><span>{publication.headline} · {publication.byline}</span></label>)}</fieldset>
        {fields.publicationIds.length ? <div><h3>Reading order</h3><ol>{fields.publicationIds.map((id, index) => <li key={id}><div className="operations-row"><span>{editionData.publications.find(publication => publication.id === id)?.headline ?? 'Article no longer available — remove before saving'}</span><button className="button secondary" type="button" disabled={disabled || index === 0} aria-label={`Move article ${index + 1} earlier`} onClick={() => moveArticle(id, -1)}>Move up</button><button className="button secondary" type="button" disabled={disabled || index === fields.publicationIds.length - 1} aria-label={`Move article ${index + 1} later`} onClick={() => moveArticle(id, 1)}>Move down</button><button className="button secondary" type="button" disabled={disabled} onClick={() => setFields(current => ({ ...current, publicationIds: current.publicationIds.filter(value => value !== id) }))}>Remove</button></div></li>)}</ol></div> : null}
        <div><button className="button primary" disabled={disabled || !fields.publicationIds.length}>{busy === 'draft' ? 'Saving draft…' : 'Save draft for review'}</button></div>
      </form>
    </section>

    <section className="operations-section" id="edition-review" aria-labelledby="review-heading">
      <h2 id="review-heading">Review &amp; delivery</h2>
      {editionData.editions.length ? <><label>Choose an edition<select value={selectedEditionId} onChange={event => { setSelectedEditionId(event.target.value); setReviewConfirmed(''); setSendConfirmed(''); }}><option value="">Select an edition</option>{editionData.editions.map(edition => <option key={edition.id} value={edition.id}>No. {edition.number} · {edition.date} · {edition.title} · {edition.status === 'released' ? 'Released' : 'Draft'}</option>)}</select></label>{selectedEdition ? <>
        <p className="eyebrow">No. {selectedEdition.number} · {selectedEdition.date} · {selectedEdition.status === 'released' ? 'Released' : 'Draft awaiting review'}</p>
        <h3>{selectedEdition.title}</h3><p>{selectedEdition.preview}</p><p>{selectedEdition.articles.length} articles, in the reading order below. Last saved {dateLabel(selectedEdition.updatedAt)}.</p>
        <ol>{selectedEdition.articles.map(article => <li key={article.publicationId}><details><summary><strong>{article.headline}</strong> · {article.byline}</summary>{article.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{article.limitations.length ? <p><strong>Reporting notes:</strong> {article.limitations.join(' ')}</p> : null}<p><Link href={`/editorial/${article.storyId}`}>Open the editorial record</Link></p></details></li>)}</ol>
        {selectedEdition.status === 'draft' ? <><p>Release makes this reviewed edition available in the member archive. Sending email is a separate action.</p><label className="operations-row"><input type="checkbox" checked={reviewConfirmed === selectedEdition.reviewHash} onChange={event => setReviewConfirmed(event.target.checked ? selectedEdition.reviewHash : '')} />I have reviewed this exact title, free preview, article content and reading order.</label><div className="operations-row"><button className="button secondary" disabled={disabled} onClick={() => editDraft(selectedEdition)}>Edit this draft</button><button className="button primary" disabled={disabled || reviewConfirmed !== selectedEdition.reviewHash} onClick={() => void action('release', async () => { await api(`/api/owner/editions/${selectedEdition.id}`, { method: 'POST', body: { action: 'release', expectedReviewHash: selectedEdition.reviewHash } }); setReviewConfirmed(''); return 'Edition released to the archive. No email has been queued.'; })}>{busy === 'release' ? 'Releasing…' : 'Release reviewed edition'}</button></div></> : <>
          <p><Link href={`/editions/${selectedEdition.id}`}>Open the released edition</Link> · Released {dateLabel(selectedEdition.releasedAt ?? selectedEdition.updatedAt)}</p>
          {!editionData.delivery.configured ? <p className="notice">Email delivery needs its verified sender and secure sign-in configuration before an edition can be sent.</p> : null}
          {campaign ? <p><strong>{campaign.recipients} reader{campaign.recipients === 1 ? '' : 's'} queued</strong> on {dateLabel(campaign.queuedAt)}. This edition is already scheduled for delivery; it will not be queued twice.</p> : <><p>{eligibleCount === undefined ? 'Refresh service health to confirm the number of readers eligible for this edition.' : `${eligibleCount} confirmed paying reader${eligibleCount === 1 ? ' is' : 's are'} eligible for edition emails.`} Recipients must have opted in and remain eligible when the email is sent.</p><label className="operations-row"><input type="checkbox" checked={sendConfirmed === selectedEdition.reviewHash} onChange={event => setSendConfirmed(event.target.checked ? selectedEdition.reviewHash : '')} />Send this released edition to its eligible readers.</label><button className="button primary" disabled={disabled || sendConfirmed !== selectedEdition.reviewHash || !editionData.delivery.configured || !eligibleCount} onClick={() => void action('send', async () => { const result = await api<{ queued: number; alreadyQueued: boolean }>(`/api/owner/editions/${selectedEdition.id}`, { method: 'POST', body: { action: 'send', expectedReviewHash: selectedEdition.reviewHash } }); setSendConfirmed(''); return `${result.queued} readers ${result.alreadyQueued ? 'were already queued' : 'queued for delivery'}.`; })}>{busy === 'send' ? 'Queueing readers…' : 'Send this edition'}</button></>}
          {campaign ? <><h3>Delivery progress</h3><dl className="operations-row">{Object.entries(selectedCounts).filter(([, count]) => count > 0).map(([status, count]) => <div key={status}><dt>{statusLabel[status]}</dt><dd>{count}</dd></div>)}</dl><button className="button secondary" disabled={Boolean(busy) || !(selectedCounts.pending || selectedCounts.sending)} onClick={() => void action('process', async () => { const result = await api<{ processed: number; sent: number }>(`/api/owner/editions/${selectedEdition.id}`, { method: 'POST', body: { action: 'process', expectedReviewHash: selectedEdition.reviewHash } }); return result.processed ? `Processed ${result.processed} delivery jobs; ${result.sent} accepted by the email provider.` : 'No delivery jobs are due yet. Pending retries wait briefly before trying again.'; })}>{busy === 'process' ? 'Processing delivery…' : 'Process queued delivery'}</button><p>The scheduler also processes queued editions. Failed or uncertain sends keep their delivery record; they are never automatically restarted as a new campaign.</p><details><summary>Reader delivery results</summary><table><thead><tr><th scope="col">Reader</th><th scope="col">Delivery</th><th scope="col">Attempts</th><th scope="col">Notes</th></tr></thead><tbody>{selectedJobs.map(job => <tr key={job.id}><td>{job.email}</td><td>{statusLabel[job.status]}</td><td>{job.attempts}</td><td>{job.lastError || '—'}</td></tr>)}</tbody></table></details></> : null}
        </>}
      </> : <p>Select an edition to review its contents and delivery status.</p>}</> : <p>No editions have been prepared yet.</p>}
    </section>

    <section className="operations-section" id="subscriptions" aria-labelledby="subscriptions-heading">
      <h2 id="subscriptions-heading">Readers &amp; subscriptions</h2>
      <p><strong>{billing.memberCount} registered reader{billing.memberCount === 1 ? '' : 's'}</strong> · {billing.paidMemberCount} with paid access · {billing.readiness.salesOpen ? 'New subscriptions are open' : 'New subscriptions are closed'}</p>
      <p>{billing.settings.monthlyAmount ? `Validated monthly price: ${new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(billing.settings.monthlyAmount / 100)}.` : 'No monthly price is set. Choose the approved monthly AUD price before opening subscriptions.'} {billing.readiness.mode === 'test' ? 'Stripe is in test mode.' : billing.readiness.mode === 'live' ? 'Stripe is connected in live mode.' : 'Stripe is not connected.'}</p>
      {billing.readiness.blockers.length ? <div><h3>Before sales can open</h3><ul>{billing.readiness.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div> : null}
      <form onSubmit={event => { event.preventDefault(); void action('price', async () => { await api('/api/billing/settings', { method: 'PATCH', body: { priceId: priceId.trim() || null, liveSalesEnabled: false } }); return priceId.trim() ? 'Monthly price validated. Sales remain closed until you explicitly open them below.' : 'Price removed. New subscriptions are closed.'; }); }}>
        <label>Monthly AUD price from Stripe<input value={priceId} pattern="price_[A-Za-z0-9]+" placeholder="price_…" autoComplete="off" onChange={event => setPriceId(event.target.value)} /></label><p>Use an active fixed monthly subscription price. Saving or changing the price closes new sales while you review it.</p><div><button className="button secondary" disabled={Boolean(busy)}>{busy === 'price' ? 'Validating price…' : priceId.trim() ? 'Validate price & keep sales closed' : 'Clear price & close sales'}</button></div>
      </form>
      <form onSubmit={event => { event.preventDefault(); void action('sales', async () => { await api('/api/billing/settings', { method: 'PATCH', body: { liveSalesEnabled: salesEnabled } }); return salesEnabled ? 'New subscriptions are open at the validated price.' : 'New subscriptions are closed.'; }); }}><label className="operations-row"><input type="checkbox" checked={salesEnabled} disabled={!billing.readiness.priceConfigured && !billing.settings.liveSalesEnabled} onChange={event => setSalesEnabled(event.target.checked)} />Open new subscriptions at the validated monthly price.</label><div><button className="button primary" disabled={Boolean(busy) || salesEnabled === billing.settings.liveSalesEnabled}>{busy === 'sales' ? 'Saving sales setting…' : 'Save sales setting'}</button></div></form>
    </section>

    <section className="operations-section" id="published-stories" aria-labelledby="stories-heading">
      <h2 id="stories-heading">Published stories &amp; corrections</h2>
      <p>Change a story’s visibility, record a withdrawal, or open a correction for fresh editorial review.</p>
      {newsroom.state.publications.filter(publication => publication.mode === 'live').length ? newsroom.state.publications.filter(publication => publication.mode === 'live').map(publication => <PublicationActions key={`${publication.id}-${publication.status}-${publication.access}`} publication={publication} disabled={disabled} onAction={(body, message) => action(`publication-${publication.id}`, async () => { await api('/api/editorial', { method: 'POST', body }); return message; })} />) : <p>There are no live published stories yet.</p>}
    </section>

    <section className="operations-section" id="health" aria-labelledby="health-heading">
      <h2 id="health-heading">Service health &amp; records</h2>
      {health ? <><p><strong>{health.status === 'healthy' ? 'Services are operating normally.' : health.status === 'paused' ? 'Research is paused.' : 'Some services need attention.'}</strong> {health.latestLiveRunAt ? `Last live research run: ${dateLabel(health.latestLiveRunAt)}.` : 'No live research run has been recorded.'}</p>{health.issues.length ? <ul>{health.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul> : null}<p>{health.totals.completed} research runs completed · {health.totals.failed} failed · {health.totals.interrupted} interrupted.</p><details><summary>Research usage</summary><p>{health.totals.inputTokens.toLocaleString()} input tokens · {health.totals.outputTokens.toLocaleString()} output tokens.</p><p>Recorded known cost: {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD' }).format(health.totals.estimatedKnownCostUsd)}. {health.totals.unpricedRuns} runs have no price estimate.</p><p>{health.costNote}</p></details></> : <p>Detailed operations health is not available yet. Current service checks appear below.</p>}
      {health ? <section aria-labelledby="recent-runs-heading"><h3 id="recent-runs-heading">Recent research runs</h3>
        {!health.ownerAlertsConfigured ? <p>Owner email alerts are not configured. Failed runs remain visible here.</p> : <p>Owner alerts are sent only when you choose “Email owner alert” for a failed or interrupted run.</p>}
        {health.runs.length ? <div style={{ overflowX: 'auto' }}><table><caption>Latest runs, with recorded usage and any follow-up needed</caption><thead><tr><th scope="col">Started</th><th scope="col">Mode</th><th scope="col">Result</th><th scope="col">Recorded tokens</th><th scope="col">Estimated cost</th><th scope="col">Follow-up</th></tr></thead><tbody>{health.runs.map(run => {
          const alert = health.alerts.find(item => item.runId === run.id);
          const stale = health.staleRunIds.includes(run.id);
          const canAlert = run.status === 'failed' || run.status === 'interrupted';
          return <tr key={run.id}><td><time dateTime={run.startedAt}>{dateLabel(run.startedAt)}</time></td><td>{run.mode === 'demo' ? 'Practice' : run.mode === 'collect' ? 'Source collection' : 'Live research'}</td><td>{stale ? 'Needs interruption review' : run.status === 'running' ? 'Running' : run.status === 'completed' ? 'Completed' : run.status === 'failed' ? 'Failed' : 'Interrupted'}{run.error ? <p>{run.error}</p> : null}</td><td>{run.usage.length ? <>{run.inputTokens.toLocaleString()} in<br />{run.outputTokens.toLocaleString()} out</> : 'Not reported'}</td><td>{run.estimatedUsd === null ? 'Not available' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(run.estimatedUsd)}</td><td>
            {stale ? <button className="button secondary" disabled={disabled} onClick={() => void action(`interrupt-${run.id}`, async () => { await api('/api/owner/operations', { method: 'POST', body: { action: 'mark_interrupted', runId: run.id } }); return 'The expired run record is marked interrupted. Review the newsroom before starting another run.'; })}>{busy === `interrupt-${run.id}` ? 'Updating…' : 'Mark interrupted'}</button> : null}
            {canAlert ? <><button className="button secondary" disabled={Boolean(busy) || !health.ownerAlertsConfigured || Boolean(alert)} onClick={() => void action(`alert-${run.id}`, async () => { const result = await api<{ status: string }>('/api/owner/operations', { method: 'POST', body: { action: 'alert', runId: run.id } }); return result.status === 'sent' ? 'Owner alert accepted by the email provider.' : result.status === 'not_configured' ? 'Owner email alerts are not configured.' : result.status === 'unknown' ? 'The alert outcome is uncertain. Check the email provider before any further action.' : result.status === 'failed' ? 'The email provider rejected the owner alert. Review its delivery record.' : 'The owner alert is already being processed.'; })}>{busy === `alert-${run.id}` ? 'Sending alert…' : 'Email owner alert'}</button>{alert ? <p>{alert.status === 'sent' ? 'Alert sent.' : alert.status === 'sending' ? 'Alert is being processed.' : alert.status === 'unknown' ? 'Alert outcome unconfirmed; check the provider record.' : 'Alert failed; check the provider record.'}</p> : null}</> : !stale ? '—' : null}
          </td></tr>;
        })}</tbody></table></div> : <p>No research runs have been recorded yet.</p>}
      </section> : null}
      <dl>{newsroom.config.readiness.map(check => <div key={check.name}><dt><strong>{check.name}: {check.ready ? 'Ready' : 'Needs attention'}</strong></dt><dd>{check.detail}</dd></div>)}</dl>
      <div className="operations-row"><Link className="button secondary" href="/newsroom">Manage sources &amp; research</Link><a className="button secondary" href="/api/owner/backup" download>Download private backup</a></div><p>The backup contains the newsroom’s evidence, editorial records, members and delivery history.</p>
    </section>
  </main>;
}

function PublicationActions({ publication, disabled, onAction }: { publication: Publication; disabled: boolean; onAction: (body: unknown, message: string) => Promise<void> }) {
  const [choice, setChoice] = useState<'access' | 'status' | 'correction'>('access');
  const [access, setAccess] = useState<'public' | 'members'>(publication.access ?? 'members');
  const [status, setStatus] = useState<'published' | 'retracted' | 'removed'>(publication.status ?? 'published');
  const [note, setNote] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = choice === 'access' ? { action: 'publication_access', publicationId: publication.id, access, note } : choice === 'status' ? { action: 'publication_status', publicationId: publication.id, status, note } : { action: 'correction', publicationId: publication.id, reason: note };
    await onAction(body, choice === 'correction' ? 'Correction opened for research and editorial review. Find it in the newsroom; it is not automatically published.' : 'Publication updated. Edition reading and pending delivery recheck this story’s current status.');
  }
  return <details><summary><strong>{publication.draft.headline}</strong> · {publication.status === 'removed' ? 'Removed' : publication.status === 'retracted' ? 'Retracted' : 'Published'} · {publication.access === 'public' ? 'Free to read' : 'Members only'}</summary><p><Link href={`/editorial/${publication.storyId}`}>Open the editorial record</Link> · Approved {dateLabel(publication.approvedAt)}</p><form onSubmit={submit}><label>Editorial action<select value={choice} onChange={event => setChoice(event.target.value as typeof choice)}><option value="access">Change reader access</option><option value="status">Change publication status</option><option value="correction">Open a correction</option></select></label>{choice === 'access' ? <label>Who can read this story?<select value={access} onChange={event => setAccess(event.target.value as typeof access)}><option value="members">Paid members</option><option value="public">Everyone — free sample</option></select></label> : choice === 'status' ? <label>Publication status<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="published">Published</option><option value="retracted">Retracted — preserve a public notice</option><option value="removed">Removed from readers</option></select></label> : <p>A correction starts a new editorial record tied to this publication and requires its own review and approval.</p>}<label>{choice === 'correction' ? 'What needs correcting? This explanation becomes public with the approved correction.' : choice === 'status' ? 'Public notice explaining this status change' : 'Private editorial reason for changing access'}<textarea required minLength={10} maxLength={3000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label><div><button className="button secondary" disabled={disabled || note.trim().length < 10}>{choice === 'correction' ? 'Open correction for review' : 'Save publication change'}</button></div></form>{publication.statusHistory?.length ? <details><summary>Status history</summary>{publication.statusHistory.map((change, index) => <p key={index}>{dateLabel(change.createdAt)} · {change.status} · {change.note}</p>)}</details> : null}</details>;
}
