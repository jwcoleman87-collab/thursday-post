"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ThursdayMark } from "@/components/publication-brand";
import type { Dashboard, NeedsYouItem } from "@/lib/dashboard";
import { deskRefreshDelay } from "@/lib/desk-refresh";

const STEPS = ["Lead", "Research", "Write", "Check"];

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function Toggle({ label, hint, on, busy, onChange }: { label: string; hint: string; on: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="desk-toggle">
      <div>
        <strong>{label}</strong>
        <p>{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} className={on ? "on" : ""} onClick={() => onChange(!on)}>
        <span />
      </button>
    </div>
  );
}

function ArticleCard({ item, busy, onDecide }: { item: NeedsYouItem; busy: boolean; onDecide: (item: NeedsYouItem, decision: "approve" | "reject", wagering: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const autoSoon = /Publishes automatically/.test(item.reason);
  return (
    <article className="desk-card desk-article">
      <div className="desk-article-head">
        <span className={`desk-pill ${autoSoon ? "pill-good" : "pill-attention"}`}>{autoSoon ? "Ready" : "Needs your OK"}</span>
        <span className="desk-muted">By {item.writer}</span>
      </div>
      <h3>{item.headline}</h3>
      <p className="desk-reason">{item.reason}</p>
      {open && (
        <div className="desk-read">
          {item.paragraphs.map((text, index) => <p key={index}>{text}</p>)}
          {item.sources.length > 0 && (
            <div className="desk-sources">
              <span>Sources</span>
              {item.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}
            </div>
          )}
        </div>
      )}
      {item.action === "approve" ? (
        <div className="desk-actions">
          <button type="button" className="desk-link-button" onClick={() => setOpen(!open)}>{open ? "Hide article" : "Read it"}</button>
          <span className="desk-spacer" />
          {item.wagering && (
            <label className="desk-check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} /> I’ve checked the betting content</label>
          )}
          <button type="button" className="desk-button ghost" disabled={busy} onClick={() => onDecide(item, "reject", false)}>Don’t publish</button>
          <button type="button" className="desk-button" disabled={busy || (item.wagering && !checked)} onClick={() => onDecide(item, "approve", checked)}>Publish</button>
        </div>
      ) : (
        <div className="desk-actions">
          <button type="button" className="desk-link-button" onClick={() => setOpen(!open)}>{open ? "Hide article" : "Read it"}</button>
          <span className="desk-spacer" />
          <Link className="desk-button ghost" href={`/editorial/${encodeURIComponent(item.storyId)}`}>Open in full editor</Link>
        </div>
      )}
    </article>
  );
}

export default function EditorDesk() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "The desk could not load.");
      setData(await response.json());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The desk could not load.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Track whether this tab is on screen; a hidden tab must not keep reading the database.
  const [visible, setVisible] = useState(true);
  const wasVisible = useRef(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  // Coming back to the tab refreshes once, so the desk is never stale when you look at it.
  useEffect(() => {
    if (visible && !wasVisible.current) load();
    wasVisible.current = visible;
  }, [visible, load]);

  // Refresh quietly while visible: every 15 seconds while agents are working, otherwise every minute.
  useEffect(() => {
    clearTimeout(timer.current);
    const delay = deskRefreshDelay({ visible, running: Boolean(data?.settings.running) || busy === "run" });
    if (delay !== null) timer.current = setTimeout(load, delay);
    return () => clearTimeout(timer.current);
  }, [data, busy, load, visible]);

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch("/api/newsroom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "That didn’t work. Try again in a minute.");
      setNotice(done);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "That didn’t work.");
    } finally {
      setBusy(null);
      await load();
    }
  };

  const runNow = () => {
    // The request can take several minutes; the page keeps refreshing so you can watch progress.
    act("run", { action: "run", mode: "live" }, "Run finished. See what the agents did below.");
    setTimeout(load, 3000);
  };
  const decide = (item: NeedsYouItem, decision: "approve" | "reject", wagering: boolean) =>
    act(item.storyId, { action: "decision", storyId: item.storyId, decision, note: decision === "approve" ? "Approved from the editor’s desk." : "Not published, from the editor’s desk.", wageringAcknowledged: wagering, expectedDraftHash: item.draftHash }, decision === "approve" ? "Published. It’s now in the paper." : "Okay, that one won’t be published.");
  const signOut = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.assign("/login");
  };

  if (!data) {
    return (
      <main className="desk">
        <div className="desk-loading">{error ? <><p>{error}</p><button className="desk-button" onClick={load}>Try again</button></> : <p>Opening the editor’s desk…</p>}</div>
      </main>
    );
  }

  const { status, settings, counts } = data;
  const running = settings.running || busy === "run";
  const setupFirst = data.setup.filter(item => !/Automatic runs are paused/.test(item.title));

  return (
    <main className="desk">
      <header className="desk-top">
        <Link href="/news" className="desk-brand" aria-label="Thursday Post front page">
          <ThursdayMark className="desk-mark" />
          <span>Thursday Post</span>
          <em>Editor’s desk</em>
        </Link>
        <nav>
          <Link href="/news" target="_blank">Read the paper ↗</Link>
          <Link href="/newsroom/detail">Detailed newsroom</Link>
          <button type="button" className="desk-link-button" onClick={signOut}>Sign out</button>
        </nav>
      </header>

      <section className={`desk-status tone-${running ? "working" : status.tone}`} aria-live="polite">
        <div className="desk-status-text">
          <span className="desk-dot" aria-hidden="true" />
          <div>
            <h1>{running ? "The agents are working right now" : status.title}</h1>
            <p>{running ? "Research, writing and checking can take up to five minutes. This page updates itself." : status.detail}</p>
            {data.lastRun && <p className="desk-muted">Last run {ago(data.lastRun.at)}: {data.lastRun.text}.{settings.monitoring ? " The next automatic run is within two hours." : ""}</p>}
          </div>
        </div>
        <button type="button" className="desk-button large" disabled={running || !settings.aiReady} onClick={runNow} title={settings.aiReady ? undefined : "Connect the AI first (see below)."}>
          {running ? "Working…" : "Run the agents now"}
        </button>
      </section>

      {notice && <p className="desk-notice" role="status">{notice}</p>}

      <section className="desk-numbers" aria-label="At a glance">
        <div><strong>{counts.publishedThisWeek}</strong><span>published this week</span></div>
        <div><strong>{counts.inProgress}</strong><span>in the works</span></div>
        <div className={counts.needsYou || setupFirst.length ? "hot" : ""}><strong>{counts.needsYou + setupFirst.length}</strong><span>need{counts.needsYou + setupFirst.length === 1 ? "s" : ""} you</span></div>
      </section>

      <div className="desk-columns">
        <div className="desk-main">
          {(setupFirst.length > 0 || data.needsYou.length > 0) && (
            <section className="desk-section">
              <h2>Needs you</h2>
              {setupFirst.map(item => (
                <div className="desk-card desk-setup" key={item.title}>
                  <span className="desk-pill pill-attention">Fix</span>
                  <h3>{item.title}</h3>
                  <p>{item.fix}</p>
                </div>
              ))}
              {data.needsYou.map(item => <ArticleCard key={item.storyId} item={item} busy={busy === item.storyId} onDecide={decide} />)}
            </section>
          )}

          <section className="desk-section">
            <h2>What the agents are doing</h2>
            {data.inProgress.length === 0 ? (
              <div className="desk-card desk-empty"><p>Nothing in the works right now. On the next run the agents look for fresh racing news from {counts.sourcesEnabled} source{counts.sourcesEnabled === 1 ? "" : "s"}.</p></div>
            ) : (
              <ul className="desk-pipeline">
                {data.inProgress.map(item => (
                  <li key={item.storyId} className={item.stuck ? "stuck" : ""}>
                    <div className="desk-pipeline-head">
                      <h3>{item.title}</h3>
                      <span className="desk-muted">{ago(item.updatedAt)}</span>
                    </div>
                    <ol className="desk-steps" aria-label={`Stage: ${item.stage}`}>
                      {STEPS.map((step, index) => (
                        <li key={step} className={index + 1 < item.step ? "done" : index + 1 === item.step ? (item.stuck ? "stuck" : "now") : ""}>{step}</li>
                      ))}
                    </ol>
                    <p><strong>{item.stage}.</strong> {item.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="desk-section">
            <h2>Recently published</h2>
            {data.published.length === 0 ? (
              <div className="desk-card desk-empty"><p>No articles yet. The first ones appear here as soon as they pass the checker.</p></div>
            ) : (
              <ul className="desk-published">
                {data.published.map(item => (
                  <li key={item.id}>
                    <Link href={`/news/${encodeURIComponent(item.id)}`} target="_blank">{item.headline}</Link>
                    <span className="desk-muted">{item.section} · {ago(item.publishedAt)}{item.automatic ? " · published automatically" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="desk-side">
          <section className="desk-card">
            <h2>Settings</h2>
            <Toggle label="Automatic runs" hint="Agents wake up every two hours to find, research, write and check stories." on={settings.monitoring} busy={busy === "monitoring"} onChange={next => act("monitoring", { action: "monitoring", enabled: next }, next ? "Automatic runs are on." : "Automatic runs are paused.")} />
            <Toggle label="Automatic publishing" hint="Checked articles go straight into the paper. Anything critical of a person, about betting, or a correction still waits for you." on={settings.autoPublish} busy={busy === "auto"} onChange={next => act("auto", { action: "auto_publish", enabled: next }, next ? "Checked articles will now publish on their own." : "Every article will now wait for your OK.")} />
          </section>

          <section className="desk-card">
            <h2>How the paper works</h2>
            <ol className="desk-how">
              <li><strong>Find.</strong> Agents read Racing NSW, Racing Victoria and Racing Queensland news.</li>
              <li><strong>Research.</strong> Research agents pull out the facts and keep the exact source quotes.</li>
              <li><strong>Write.</strong> A writing agent turns the facts into a short article.</li>
              <li><strong>Check.</strong> A different agent checks every sentence against the sources. If anything isn’t backed up, it goes back to the writer.</li>
              <li><strong>Publish.</strong> Checked articles go into the paper. Risky ones wait for you.</li>
            </ol>
          </section>

          <section className="desk-card">
            <div className="desk-activity-head">
              <h2>Recent activity</h2>
              <button type="button" className="desk-link-button" onClick={() => setShowActivity(!showActivity)}>{showActivity ? "Hide" : "Show"}</button>
            </div>
            {showActivity && (
              <ul className="desk-activity">
                {data.activity.length ? data.activity.map((item, index) => <li key={index}><span className="desk-muted">{ago(item.at)}</span>{item.text}</li>) : <li>No activity yet.</li>}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
