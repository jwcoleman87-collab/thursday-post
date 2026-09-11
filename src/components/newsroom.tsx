"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Database,
  FileCheck2,
  FileText,
  FlaskConical,
  Globe2,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  AlertTriangle,
  ExternalLink,
  Upload,
} from "lucide-react";
import {
  PE_AGENTS,
  RESEARCH_AGENTS,
  type NewsroomState,
  type Story,
  type StoryStatus,
  type Claim,
  type SourceItem,
} from "@/lib/domain";

type View =
  | "Overview"
  | "Stories"
  | "Evidence hub"
  | "Reader inbox"
  | "Agents"
  | "Settings";
type SourceConfig = {
  id?: string;
  name: string;
  url: string;
  type: string;
  adapter: string;
  jurisdiction?: string;
  enabled: boolean;
};
type Payload = {
  state: NewsroomState;
  config: {
    mode: "demo" | "live";
    contactEmail: string;
    running?: boolean;
    monitoring?: boolean;
    readiness: { name: string; ready: boolean; detail: string }[];
    sources?: SourceConfig[];
  };
};
const NAV: { name: View; icon: typeof Activity }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Stories", icon: FileText },
  { name: "Evidence hub", icon: Database },
  { name: "Reader inbox", icon: Inbox },
  { name: "Agents", icon: Users },
  { name: "Settings", icon: Settings2 },
];
const STATUS: Record<StoryStatus, { label: string; tone: string }> = {
  candidate: { label: "Discovered", tone: "blue" },
  researching: { label: "Researching", tone: "blue" },
  drafting: { label: "Drafting", tone: "purple" },
  waiting_approval: { label: "Your approval", tone: "pink" },
  blocked: { label: "Blocked", tone: "orange" },
  published: { label: "Published", tone: "green" },
  rejected: { label: "Rejected", tone: "grey" },
  sent_back: { label: "Changes requested", tone: "orange" },
};
function dateTime(value?: string) {
  if (!value) return "No run yet";
  return new Date(value).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  });
}
function words(value: string) {
  return value.replaceAll("_", " ");
}
function originalEmail(item: SourceItem) {
  if (!item.email) return item.content;
  if (!item.email.original)
    return (
      (item.email.headers?.map((header) => header.line).join("\n") ||
        "Original headers available in the archived email.") +
      "\n\n" +
      item.content
    );
  if (item.email.originalEncoding !== "base64") return item.email.original;
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(item.email.original), (character) =>
        character.charCodeAt(0),
      ),
    );
  } catch {
    return (
      item.email.headers?.map((header) => header.line).join("\n") +
      "\n\n" +
      item.content
    );
  }
}
function Badge({
  children,
  tone = "grey",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function StoryBadge({ story }: { story: Story }) {
  return (
    <Badge tone={STATUS[story.status].tone}>
      {story.status === "published" && story.mode === "demo"
        ? "Demo approved"
        : STATUS[story.status].label}
    </Badge>
  );
}
function Empty({
  icon: Icon = FileText,
  title,
  children,
}: {
  icon?: typeof Activity;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function Newsroom() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [view, setView] = useState<View>("Overview");
  const [mode, setMode] = useState<"demo" | "live" | "collect">("collect");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const request = useCallback(async (body?: Record<string, unknown>) => {
    const response = await fetch(
      "/api/newsroom",
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : { cache: "no-store" },
    );
    if (response.status === 401) {
      window.location.assign("/login");
      throw new Error("Please sign in to the newsroom.");
    }
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "The request could not be completed.");
    setPayload(result);
    return result as Payload;
  }, []);
  useEffect(() => {
    let active = true;
    request().catch((error) => {
      if (active) setError(error.message);
    });
    return () => {
      active = false;
    };
  }, [request]);
  useEffect(() => {
    if (busy !== "run" && !payload?.config.running) return;
    const timer = setInterval(() => {
      request().catch(() => {
        /* The running request reports its final error. */
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [busy, payload?.config.running, request]);

  async function mutate(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const result = await request(body);
      return result;
    } catch (error) {
      setError(error instanceof Error ? error.message : "The request failed.");
      return null;
    } finally {
      setBusy("");
    }
  }
  async function run() {
    const result = await mutate(
      mode === "collect" ? { action: "collect" } : { action: "run", mode },
      "run",
    );
    if (result)
      setNotice(
        mode === "collect"
          ? "Collection complete. New source records are preserved for research; no AI request or publication occurred."
          : mode === "demo"
            ? "Demo cycle complete. Open a story to inspect its evidence and make a practice approval."
            : "Newsroom cycle complete. Review the stories and any outstanding research gaps.",
      );
  }
  async function refresh() {
    setError("");
    setBusy("refresh");
    try {
      await request();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setBusy("");
    }
  }
  async function logout() {
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok)
        throw new Error("Could not sign out. Please try again.");
      window.location.assign("/login");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-out failed.");
    }
  }
  async function importEmail(file: File) {
    setBusy("email");
    setError("");
    setNotice("");
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/inbox", {
        method: "POST",
        body: data,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "The email could not be imported.");
      await request();
      setNotice(
        "Original email preserved as a private lead. Run a live cycle to evaluate and research it.",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Email import failed.");
    } finally {
      setBusy("");
    }
  }
  const state = payload?.state;
  const stories = state?.stories || [];
  const waiting = stories.filter(
    (story) => story.status === "waiting_approval",
  );
  const active = stories.filter((story) =>
    ["candidate", "researching", "drafting"].includes(story.status),
  );
  const gaps = stories
    .flatMap((story) => story.gaps)
    .filter((gap) => gap.status === "open");
  const published = state?.publications.filter((item) => item.public) || [];
  const selected = stories.find((story) => story.id === selectedId);
  const locked = !!busy || !!payload?.config.running;
  const filtered = stories.filter(
    (story) =>
      (filter === "all" || story.status === filter) &&
      `${story.title} ${story.summary}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const emailItems =
    state?.sourceItems.filter((source) => source.type === "email") || [];
  const liveReady = payload
    ? payload.config.readiness
        .filter((item) => item.name.toLowerCase() !== "reader email")
        .every((item) => item.ready)
    : false;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">T</span>
          <span>
            Thursday
            <br />
            <strong>Post</strong>
          </span>
        </Link>
        <div className="workspace-tag">
          <span className="live-dot" /> EDITOR’S WORKSPACE
        </div>
        <nav aria-label="Newsroom navigation">
          {NAV.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${view === name ? "active" : ""}`}
              aria-label={name}
              title={name}
              aria-current={view === name ? "page" : undefined}
              onClick={() => setView(name)}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Stories" && waiting.length > 0 ? (
                <span className="nav-count">{waiting.length}</span>
              ) : null}
              {name === "Reader inbox" && emailItems.length > 0 ? (
                <span className="nav-count">{emailItems.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <Link className="operations-link" href="/operations">
          Editions, subscribers &amp; publishing →
        </Link>
        <div className="sidebar-bottom">
          <div className="approval-reminder">
            <ShieldCheck size={21} />
            <strong>The final word is yours.</strong>
            <p>
              Every edition waits for your approval before it reaches readers.
            </p>
          </div>
          <Link className="newspaper-link" href="/news" target="_blank">
            View newspaper <ArrowUpRight size={16} />
          </Link>
          <div className="profile">
            <span className="avatar">JC</span>
            <div>
              <strong>James</strong>
              <small>Editor & publisher</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={logout}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-status">
              <span className={`live-dot ${busy === "run" ? "working" : ""}`} />
              {busy === "run" ? "Newsroom running" : "Human approval enabled"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh newsroom"
              disabled={!!busy}
              onClick={refresh}
            >
              <RefreshCw
                size={16}
                className={busy === "refresh" ? "spin" : ""}
              />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                THURSDAY POST /{" "}
                {view === "Overview" ? "NEWSROOM CONTROL" : view.toUpperCase()}
              </p>
              <h1>
                {view === "Overview"
                  ? "Your newsroom, at a glance."
                  : view === "Stories"
                    ? "Every story has a trail."
                    : view === "Evidence hub"
                      ? "The evidence behind the words."
                      : view === "Reader inbox"
                        ? "A direct line to your readers."
                        : view === "Agents"
                          ? "A newsroom of specialists."
                          : "Ready for the next edition."}
              </h1>
              <p>
                {view === "Overview"
                  ? "From the first lead to the final word. You decide what goes to print."
                  : view === "Stories"
                    ? "Follow stories through research, editorial review and your publication decision."
                    : view === "Evidence hub"
                      ? "Claims, sources and open questions — with provenance preserved at every step."
                      : view === "Reader inbox"
                        ? "Reader tips, corrections and first-hand accounts enter the same verification process."
                        : view === "Agents"
                          ? "Six research disciplines. Four editorial voices. One shared evidence hub."
                          : "Source connections, reader correspondence and live operating readiness."}
              </p>
            </div>
            {view === "Overview" || view === "Stories" ? (
              <div className="run-controls">
                <label className="sr-only" htmlFor="run-mode">
                  Newsroom run mode
                </label>
                <select
                  id="run-mode"
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as "demo" | "live" | "collect")
                  }
                  disabled={!!busy}
                >
                  <option value="collect">Collect sources</option>
                  <option value="demo">Demo mode</option>
                  <option value="live">Live sources</option>
                </select>
                <button
                  className="button primary run-button"
                  onClick={run}
                  disabled={locked || !payload}
                >
                  {busy === "run" ? (
                    <span className="spinner" />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                  {busy === "run" ? "Running…" : "GO · Run newsroom"}
                </button>
              </div>
            ) : null}
          </div>
          {error ? (
            <div className="notice danger" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="notice success" role="status">
              <CheckCircle2 size={17} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          ) : null}
          {!payload ? (
            <section className="panel">
              <Empty
                icon={Radio}
                title={
                  error
                    ? "The newsroom is unavailable"
                    : "Opening your newsroom…"
                }
              >
                {error ? (
                  <button className="button secondary" onClick={refresh}>
                    Try again
                  </button>
                ) : (
                  "Loading the latest stories and evidence."
                )}
              </Empty>
            </section>
          ) : (
            <>
              {view === "Overview" || view === "Stories" ? (
                <div className={`mode-note ${mode}`}>
                  <FlaskConical size={16} />
                  <span>
                    {mode === "collect" ? (
                      <>
                        <strong>Source collection.</strong> Archive enabled
                        racing sources without AI. Run live research when model
                        access is ready.
                      </>
                    ) : mode === "demo" ? (
                      <>
                        <strong>Demo workspace.</strong> Synthetic racing
                        fixtures exercise the full workflow. Demo approvals stay
                        private.
                      </>
                    ) : (
                      <>
                        <strong>Live source mode.</strong>{" "}
                        {liveReady
                          ? "Configured sources feed the research workflow."
                          : "Review connection readiness in Settings before running."}{" "}
                        Publication always needs your approval.
                      </>
                    )}
                  </span>
                  {mode === "live" && !liveReady ? (
                    <button
                      className="text-link"
                      onClick={() => setView("Settings")}
                    >
                      Check setup <ArrowRight size={14} />
                    </button>
                  ) : null}
                </div>
              ) : null}
              {busy === "run" ? (
                <div className="notice running" role="status">
                  <span className="spinner" />
                  <span>
                    Discovering leads, assigning researchers and checking
                    evidence. This bounded cycle stops at the approval gate.
                  </span>
                </div>
              ) : null}
              {view === "Overview" ? (
                <>
                  <div className="metrics">
                    <Metric
                      title="Waiting for you"
                      value={waiting.length}
                      description="Stories at the approval gate"
                      icon={FileCheck2}
                      tone="pink"
                      onClick={() => {
                        setView("Stories");
                        setFilter("waiting_approval");
                      }}
                    />
                    <Metric
                      title="In the newsroom"
                      value={active.length}
                      description="Discovery, research & drafting"
                      icon={Activity}
                      tone="blue"
                      onClick={() => {
                        setView("Stories");
                        setFilter("all");
                      }}
                    />
                    <Metric
                      title="Open evidence gaps"
                      value={gaps.length}
                      description="Targeted research still needed"
                      icon={Search}
                      tone="orange"
                      onClick={() => setView("Evidence hub")}
                    />
                    <Metric
                      title="Published stories"
                      value={published.length}
                      description="Approved & available to readers"
                      icon={BookOpen}
                      tone="green"
                      onClick={() => {
                        setView("Stories");
                        setFilter("published");
                      }}
                    />
                  </div>
                  <Workflow busy={busy === "run" || !!payload.config.running} />
                  <div className="overview-columns">
                    <section className="panel story-panel">
                      <div className="panel-heading">
                        <div>
                          <p className="eyebrow">THE EDITOR’S TRAY</p>
                          <h2>
                            Ready for your judgement{" "}
                            <span className="count">{waiting.length}</span>
                          </h2>
                        </div>
                        <button
                          className="text-link"
                          onClick={() => {
                            setView("Stories");
                            setFilter("all");
                          }}
                        >
                          All stories <ArrowRight size={15} />
                        </button>
                      </div>
                      {waiting.length ? (
                        <div className="story-list">
                          {waiting.slice(0, 4).map((story) => (
                            <StoryRow
                              key={story.id}
                              story={story}
                              onClick={() => setSelectedId(story.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <Empty
                          icon={FileCheck2}
                          title="A clear desk. A fresh edition."
                        >
                          Start a newsroom cycle to discover stories and prepare
                          evidence-backed drafts for your review.
                        </Empty>
                      )}
                      <div className="panel-foot">
                        <ShieldCheck size={14} />
                        {waiting.length
                          ? "Review the complete package before approving publication."
                          : "Nothing reaches readers without your explicit approval."}
                      </div>
                    </section>
                    <section className="panel activity-panel">
                      <div className="panel-heading">
                        <div>
                          <p className="eyebrow">ON THE RECORD</p>
                          <h2>Latest activity</h2>
                        </div>
                        <span className="live-dot" />
                      </div>
                      <AuditList
                        events={state!.audit.slice(-5).reverse()}
                        compact
                      />
                      <div className="panel-foot">
                        Last cycle: {dateTime(state!.lastRunAt)} · Sydney
                      </div>
                    </section>
                  </div>
                  <section className="source-overview">
                    <div className="source-overview-icon">
                      <Radio size={22} />
                    </div>
                    <div>
                      <h3>Start with a strong source.</h3>
                      <p>
                        {payload.config.sources?.filter(
                          (source) => source.enabled,
                        ).length || 0}{" "}
                        enabled sources · {state!.sourceItems.length} preserved
                        source items · Reader email is a first-class lead.
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setView("Settings")}
                    >
                      Manage sources <ArrowUpRight size={15} />
                    </button>
                  </section>
                </>
              ) : null}
              {view === "Stories" ? (
                <section className="panel">
                  <div className="table-toolbar">
                    <div
                      className="filter-tabs"
                      role="group"
                      aria-label="Filter stories"
                    >
                      {[
                        { value: "all", label: "All stories" },
                        { value: "waiting_approval", label: "Your approval" },
                        { value: "blocked", label: "Blocked" },
                        { value: "published", label: "Approved" },
                        { value: "sent_back", label: "Sent back" },
                        { value: "rejected", label: "Rejected" },
                      ].map((item) => (
                        <button
                          key={item.value}
                          className={filter === item.value ? "selected" : ""}
                          onClick={() => setFilter(item.value)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <label className="search-box">
                      <Search size={15} />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Find a story…"
                        aria-label="Search stories"
                      />
                    </label>
                  </div>
                  {filtered.length ? (
                    <div className="story-list">
                      {filtered.map((story) => (
                        <StoryRow
                          key={story.id}
                          story={story}
                          onClick={() => setSelectedId(story.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title={
                        stories.length
                          ? "No stories match this view"
                          : "Your next edition starts here"
                      }
                    >
                      {stories.length
                        ? "Try another filter or search term."
                        : "Press GO to discover racing leads and prepare your first approval package."}
                    </Empty>
                  )}
                </section>
              ) : null}
              {view === "Evidence hub" ? (
                <EvidenceHub state={state!} openStory={setSelectedId} />
              ) : null}
              {view === "Reader inbox" ? (
                <InboxView
                  items={emailItems}
                  email={payload.config.contactEmail}
                  stories={stories}
                  openStory={setSelectedId}
                  busy={locked}
                  onImport={importEmail}
                />
              ) : null}
              {view === "Agents" ? <AgentsView state={state!} /> : null}
              {view === "Settings" ? (
                <SettingsView
                  config={payload.config}
                  busy={locked}
                  onMonitoring={(enabled) =>
                    mutate(
                      { action: "monitoring", enabled },
                      "monitoring",
                    ).then(() => {})
                  }
                  onToggle={(sourceId, enabled) =>
                    mutate(
                      { action: "source_toggle", sourceId, enabled },
                      "source_toggle",
                    ).then(() => {})
                  }
                  onSave={async (source) => {
                    const result = await mutate(
                      { action: "source", source },
                      "source",
                    );
                    if (result) {
                      setNotice(
                        "Source saved. It will be considered during the next live newsroom cycle.",
                      );
                      return true;
                    }
                    return false;
                  }}
                />
              ) : null}
            </>
          )}
          <footer className="workspace-footer">
            <span>
              Thursday Post <span>·</span> Australian thoroughbred racing
            </span>
            <span>
              <ShieldCheck size={12} /> Evidence-led. Human-approved.
            </span>
          </footer>
        </main>
      </div>
      {selected && state ? (
        <StoryReview
          key={selected.id}
          story={selected}
          state={state}
          busy={locked}
          error={error}
          close={() => setSelectedId(null)}
          onDecision={async (decision, note, wageringAcknowledged) => {
            const result = await mutate(
              {
                action: "decision",
                storyId: selected.id,
                expectedDraftHash: selected.draft?.hash,
                decision,
                note,
                wageringAcknowledged,
              },
              "decision",
            );
            if (result)
              setNotice(
                decision === "approve"
                  ? selected.mode === "demo"
                    ? "Demo approval recorded. This fixture is kept out of the public newspaper."
                    : "Approval recorded. The article is now available in the newspaper."
                  : decision === "send_back"
                    ? "Changes requested. Your note is recorded with the story."
                    : "Story rejected. Your decision is preserved in the audit trail.",
              );
          }}
        />
      ) : null}
    </div>
  );
}

function Metric({
  title,
  value,
  description,
  icon: Icon,
  tone,
  onClick,
}: {
  title: string;
  value: number;
  description: string;
  icon: typeof Activity;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className={`metric-card ${tone}`} onClick={onClick}>
      <div className="metric-top">
        <span>{title}</span>
        <span className="metric-icon">
          <Icon size={17} />
        </span>
      </div>
      <strong className="metric-value">
        {value.toString().padStart(2, "0")}
      </strong>
      <span className="metric-description">
        {description}
        <ArrowUpRight size={14} />
      </span>
    </button>
  );
}
function Workflow({ busy }: { busy: boolean }) {
  const stages = [
    {
      title: "Sources",
      detail: "Original inputs",
      tone: "yellow",
      icon: Radio,
    },
    {
      title: "Discovery",
      detail: "Select & assign",
      tone: "green",
      icon: Sparkles,
    },
    { title: "Research", detail: "6 specialists", tone: "blue", icon: Search },
    {
      title: "Evidence hub",
      detail: "Claims & sources",
      tone: "purple",
      icon: Database,
    },
    {
      title: "Editorial",
      detail: "4 PE agents",
      tone: "green",
      icon: FileText,
    },
    {
      title: "Your approval",
      detail: "Final human gate",
      tone: "pink",
      icon: ShieldCheck,
    },
  ];
  return (
    <section className="panel workflow-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">THE NEWSROOM LOOP</p>
          <h2>A clear path from lead to print.</h2>
        </div>
        <Badge tone={busy ? "blue" : "grey"}>
          <CircleDot size={11} />
          {busy ? "Cycle in progress" : "Ready when you are"}
        </Badge>
      </div>
      <div className="workflow">
        {stages.map(({ title, detail, tone, icon: Icon }, index) => (
          <div className="workflow-piece" key={title}>
            <div className={`workflow-step ${tone}`}>
              <Icon size={20} strokeWidth={1.6} />
              <strong>{title}</strong>
              <small>{detail}</small>
            </div>
            {index < stages.length - 1 ? (
              <ArrowRight className="flow-arrow" size={16} />
            ) : null}
          </div>
        ))}
      </div>
      <div className="workflow-loop">
        <ArrowDownLeft size={14} />
        <span>
          <strong>Evidence incomplete?</strong> The controller sends a targeted
          request back to research.
        </span>
        <span className="workflow-stop">
          Compliance checked before approval
        </span>
      </div>
    </section>
  );
}
function StoryRow({ story, onClick }: { story: Story; onClick: () => void }) {
  const verified = story.claims.filter(
    (claim) => claim.status === "verified",
  ).length;
  return (
    <button className="story-row" onClick={onClick}>
      <div className="story-row-main">
        <div className="story-tags">
          <span className="story-section">
            {PE_AGENTS.find((agent) => agent.id === story.peAgentId)?.name}
          </span>
          {story.mode === "demo" ? (
            <span className="fixture-tag">DEMO</span>
          ) : null}
          {story.correctionOf ? <Badge tone="orange">Correction</Badge> : null}
        </div>
        <h3>{story.draft?.headline || story.title}</h3>
        <p>{story.summary}</p>
        <div className="story-meta">
          <span>
            <Database size={13} />
            {verified}/{story.claims.length} claims verified
          </span>
          <span>{story.researchAgentIds.length} research agents</span>
          <span>{dateTime(story.updatedAt)}</span>
        </div>
      </div>
      <div className="story-row-end">
        <StoryBadge story={story} />
        <span className="review-link">
          Open package <ArrowRight size={15} />
        </span>
      </div>
    </button>
  );
}
function AuditList({
  events,
  compact = false,
}: {
  events: NewsroomState["audit"];
  compact?: boolean;
}) {
  return events.length ? (
    <ol className={`audit-list ${compact ? "compact" : ""}`}>
      {events.map((event) => (
        <li key={event.id}>
          <span
            className={`audit-dot ${event.action.includes("approv") ? "pink" : event.action.includes("gap") ? "orange" : "green"}`}
          />
          <div>
            <strong>{words(event.action)}</strong>
            <p>{event.detail}</p>
            <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <Empty icon={Activity} title="The record starts with GO">
      Every autonomous action and editorial decision will appear here.
    </Empty>
  );
}
function ClaimCard({
  claim,
  sources,
  highlight = false,
}: {
  claim: Claim;
  sources: SourceItem[];
  highlight?: boolean;
}) {
  return (
    <details
      className={`claim-card ${highlight ? "highlight" : ""}`}
      open={highlight || undefined}
    >
      <summary>
        <span className={`claim-indicator ${claim.status}`} />
        <span className="claim-summary">
          <strong>{claim.text}</strong>
          <span className="claim-meta">
            Research Agent {claim.agentId} · {claim.confidence} confidence ·{" "}
            {words(claim.verificationScope)}
          </span>
        </span>
        <Badge
          tone={
            claim.status === "verified"
              ? "green"
              : claim.status === "disputed"
                ? "pink"
                : "orange"
          }
        >
          {claim.status}
        </Badge>
      </summary>
      <div className="claim-detail">
        <p className="mono">Claim ID: {claim.id}</p>
        {claim.verificationScope === "source_statement" ? (
          <p className="qualification">
            Verification establishes what the source states. It does not
            independently prove the underlying event.
          </p>
        ) : null}
        {claim.evidence.map((evidence) => {
          const source = sources.find((item) => item.id === evidence.sourceId);
          return (
            <div className="evidence-record" key={evidence.id}>
              <div className="evidence-heading">
                <Badge
                  tone={evidence.relation === "supports" ? "green" : "pink"}
                >
                  {evidence.relation}
                </Badge>
                <span>
                  {evidence.exactMatch
                    ? "Exact source match"
                    : "Source match unconfirmed"}
                </span>
              </div>
              <blockquote>{evidence.quote}</blockquote>
              <div className="source-credit">
                <strong>{source?.sourceName || "Source unavailable"}</strong>
                {source?.url.startsWith("https://") ||
                source?.url.startsWith("http://") ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Original source <ArrowUpRight size={13} />
                  </a>
                ) : (
                  <span>Private source reference</span>
                )}
              </div>
              <p className="quiet">
                {source ? (
                  <a
                    className="text-link"
                    href={`/api/sources/${encodeURIComponent(source.id)}`}
                  >
                    Download archived source <ArrowUpRight size={12} />
                  </a>
                ) : null}
              </p>
              <p className="quiet">
                Published {dateTime(source?.publishedAt)} · Retrieved{" "}
                {dateTime(source?.retrievedAt)}
              </p>
              <p className="mono">Independence: {evidence.independenceKey}</p>
            </div>
          );
        })}
        {claim.questions.length ? (
          <div className="notice warning">
            <AlertTriangle size={15} />
            <div>
              <strong>Outstanding questions</strong>
              {claim.questions.map((question) => (
                <p key={question}>{question}</p>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
function EvidenceHub({
  state,
  openStory,
}: {
  state: NewsroomState;
  openStory: (id: string) => void;
}) {
  const claims = state.stories.flatMap((story) => story.claims);
  return (
    <>
      <div className="hub-summary">
        <div>
          <Database size={23} />
          <strong>{claims.length}</strong>
          <span>claims preserved</span>
        </div>
        <div>
          <CheckCircle2 size={23} />
          <strong>
            {claims.filter((claim) => claim.status === "verified").length}
          </strong>
          <span>verified within stated scope</span>
        </div>
        <div>
          <Radio size={23} />
          <strong>{state.sourceItems.length}</strong>
          <span>original source records</span>
        </div>
      </div>
      <div className="notice informational">
        <Database size={17} />
        <span>
          The hub holds verified and unverified material. Each claim carries its
          own status, verification scope and confidence.
        </span>
      </div>
      {state.stories.length ? (
        state.stories.map((story) => (
          <section className="panel hub-story" key={story.id}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">
                  {story.mode === "demo"
                    ? "DEMO EVIDENCE PACKAGE"
                    : "EVIDENCE PACKAGE"}
                </p>
                <h2>{story.title}</h2>
              </div>
              <button className="text-link" onClick={() => openStory(story.id)}>
                Full package <ArrowRight size={15} />
              </button>
            </div>
            <div className="claim-list">
              {story.claims.length ? (
                story.claims.map((claim) => (
                  <ClaimCard
                    key={claim.id}
                    claim={claim}
                    sources={state.sourceItems}
                  />
                ))
              ) : (
                <p className="quiet">No claims recorded yet.</p>
              )}
            </div>
            {story.gaps.length ? (
              <div className="hub-gaps">
                <h3>Research controller</h3>
                {story.gaps.map((gap) => (
                  <div className="gap-row" key={gap.id}>
                    <Badge
                      tone={gap.status === "resolved" ? "green" : "orange"}
                    >
                      {gap.status}
                    </Badge>
                    <div>
                      <strong>{gap.question}</strong>
                      <p>
                        Assigned to Research Agent {gap.agentId}
                        {gap.blocking ? " · Blocking editorial use" : ""}
                      </p>
                      {gap.resolution ? (
                        <p className="gap-resolution">{gap.resolution}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ))
      ) : (
        <section className="panel">
          <Empty
            icon={Database}
            title="A source of truth, built claim by claim"
          >
            Run a newsroom cycle to follow original sources into structured
            research and the shared evidence hub.
          </Empty>
        </section>
      )}
    </>
  );
}
function InboxView({
  items,
  email,
  stories,
  openStory,
  busy,
  onImport,
}: {
  items: SourceItem[];
  email: string;
  stories: Story[];
  openStory: (id: string) => void;
  busy: boolean;
  onImport: (file: File) => Promise<void>;
}) {
  return (
    <>
      <div className="contact-banner">
        <span className="empty-icon">
          <Mail size={25} />
        </span>
        <div>
          <p className="eyebrow">READER CORRESPONDENCE</p>
          <h2>{email || "Contact address awaiting confirmation"}</h2>
          <p>
            Private leads stay in the newsroom. Corrections receive priority.
          </p>
        </div>
        <Badge tone="purple">Private provenance</Badge>
      </div>
      <div className="notice informational">
        <ShieldCheck size={17} />
        <span>
          An email is a lead, never proof on its own. Research must establish
          source independence and corroborate factual claims.
        </span>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Incoming reader material</h2>
          <div className="inbox-import">
            <Badge>{items.length} preserved</Badge>
            <label
              className={`button secondary small ${busy ? "disabled" : ""}`}
            >
              <Upload size={13} />
              Import .eml
              <input
                type="file"
                accept=".eml,message/rfc822"
                className="sr-only"
                disabled={busy}
                aria-label="Import original email file"
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  if (file) await onImport(file);
                  input.value = "";
                }}
              />
            </label>
          </div>
        </div>
        {items.length ? (
          <div className="inbox-list">
            {[...items]
              .sort(
                (a, b) => Number(!!b.isCorrection) - Number(!!a.isCorrection),
              )
              .map((item) => (
                <article className="inbox-item" key={item.id}>
                  <div className="inbox-item-heading">
                    <span className="mail-avatar">
                      <Mail size={17} />
                    </span>
                    <div>
                      <h3>{item.email?.subject || item.title}</h3>
                      <p>
                        {item.email?.from || item.sourceName} ·{" "}
                        {dateTime(item.email?.receivedAt || item.retrievedAt)}
                      </p>
                    </div>
                    {item.isCorrection ? (
                      <Badge tone="orange">Correction · Priority</Badge>
                    ) : (
                      <Badge tone="purple">Reader lead</Badge>
                    )}
                    {item.demo ? <Badge>Demo</Badge> : null}
                  </div>
                  <p>
                    {item.content.slice(0, 420)}
                    {item.content.length > 420 ? "…" : ""}
                  </p>
                  <div className="inbox-actions">
                    {stories
                      .filter((story) => story.sourceItems.includes(item.id))
                      .map((story) => (
                        <button
                          key={story.id}
                          className="text-link"
                          onClick={() => openStory(story.id)}
                        >
                          Open related research <ArrowRight size={14} />
                        </button>
                      ))}
                  </div>
                  <details className="private-original">
                    <summary>Original email & provenance</summary>
                    <p className="mono">
                      Source ID: {item.id}
                      <br />
                      Message ID: {item.email?.messageId || "Not supplied"}
                      <br />
                      Independence key: {item.independenceKey}
                    </p>
                    <pre>{originalEmail(item)}</pre>
                    <a
                      className="text-link"
                      href={`/api/sources/${encodeURIComponent(item.id)}`}
                    >
                      Download original email <ArrowUpRight size={13} />
                    </a>
                  </details>
                </article>
              ))}
          </div>
        ) : (
          <Empty icon={Inbox} title="A quiet inbox, for now">
            Reader emails will appear here after the inbound email connection is
            configured and receives a message.
          </Empty>
        )}
      </section>
    </>
  );
}
function AgentsView({ state }: { state: NewsroomState }) {
  return (
    <>
      <div className="section-heading">
        <span className="section-number blue">01</span>
        <div>
          <p className="eyebrow">RESEARCH LAYER</p>
          <h2>Six distinct ways to test a story.</h2>
        </div>
        <Badge tone="blue">Structured evidence, never finished articles</Badge>
      </div>
      <div className="agent-grid">
        {RESEARCH_AGENTS.map((agent) => {
          const tasks = state.tasks.filter((task) => task.agentId === agent.id);
          const running = tasks.filter(
            (task) => task.status === "running" || task.status === "pending",
          ).length;
          return (
            <section className="agent-card" key={agent.id}>
              <div className="agent-top">
                <span className="agent-number">R{agent.id}</span>
                <Badge tone={running ? "blue" : "grey"}>
                  {running ? `${running} assigned` : "Ready"}
                </Badge>
              </div>
              <p className="eyebrow">RESEARCH AGENT {agent.id}</p>
              <h3>{agent.name}</h3>
              <p>{agent.description}</p>
              <div className="agent-stats">
                <span>
                  {tasks.filter((task) => task.status === "completed").length}{" "}
                  completed tasks
                </span>
                <span>
                  {tasks.filter((task) => task.status === "failed").length}{" "}
                  failed
                </span>
              </div>
            </section>
          );
        })}
      </div>
      <div className="section-heading">
        <span className="section-number green">02</span>
        <div>
          <p className="eyebrow">EDITORIAL LAYER</p>
          <h2>Four voices. The same standard of evidence.</h2>
        </div>
      </div>
      <div className="editorial-grid">
        {PE_AGENTS.map((agent) => (
          <section className="agent-card editorial" key={agent.id}>
            <div className="agent-top">
              <span className="agent-number">PE{agent.id}</span>
              <Badge tone="green">Byline: Agent {agent.id}</Badge>
            </div>
            <h3>{agent.name}</h3>
            <p>{agent.description}</p>
            <div className="agent-stats">
              {
                state.runs.filter(
                  (run) =>
                    run.agentType === "editorial" &&
                    run.agentId === agent.id &&
                    run.status === "completed",
                ).length
              }{" "}
              completed editorial runs
            </div>
          </section>
        ))}
      </div>
      <section className="specialist-panel">
        <span className="empty-icon">
          <Activity size={25} />
        </span>
        <div>
          <p className="eyebrow">SEPARATE SPECIALIST</p>
          <h3>Racing Form & Wagering Analysis</h3>
          <p>
            Form-based analysis uses verified inputs and qualified confidence.
            Wagering material requires current policy review and your explicit
            approval.
          </p>
        </div>
        <Badge tone="orange">Blocked · Verified form feed needed</Badge>
      </section>
    </>
  );
}
function SettingsView({
  config,
  busy,
  onSave,
  onToggle,
  onMonitoring,
}: {
  config: Payload["config"];
  busy: boolean;
  onSave: (source: SourceConfig) => Promise<boolean>;
  onToggle: (sourceId: string, enabled: boolean) => Promise<void>;
  onMonitoring: (enabled: boolean) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await onSave({
      name: String(data.get("name")),
      url: String(data.get("url")),
      type: String(data.get("type")),
      adapter: String(data.get("adapter")),
      jurisdiction: String(data.get("jurisdiction")),
      enabled: true,
    });
    if (saved) {
      form.reset();
      setAdding(false);
    }
  }
  return (
    <div className="settings-stack">
      <section className="monitoring-panel">
        <div>
          <p className="eyebrow">AUTONOMOUS SOURCE MONITORING</p>
          <h3>Keep the newsroom listening.</h3>
          <p>
            One daily source cycle on Vercel. Every story still stops for your
            approval.
          </p>
        </div>
        <button
          className={`toggle ${config.monitoring ? "on" : ""}`}
          role="switch"
          aria-checked={!!config.monitoring}
          aria-label="Daily source monitoring"
          disabled={busy}
          onClick={() => onMonitoring(!config.monitoring)}
        >
          <span />
        </button>
        <span className="quiet">
          {config.monitoring ? "Enabled" : "Paused"}
        </span>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">OPERATING READINESS</p>
            <h2>Know what is connected.</h2>
          </div>
          <Badge
            tone={
              config.readiness.every((item) => item.ready) ? "green" : "orange"
            }
          >
            {config.readiness.filter((item) => item.ready).length}/
            {config.readiness.length} ready
          </Badge>
        </div>
        <div className="readiness-list">
          {config.readiness.map((item) => (
            <div className="readiness-item" key={item.name}>
              {item.ready ? (
                <CheckCircle2 className="green-text" size={21} />
              ) : (
                <CircleDot className="orange-text" size={21} />
              )}
              <div>
                <strong>{item.name}</strong>
                <p>{item.detail}</p>
              </div>
              <Badge tone={item.ready ? "green" : "orange"}>
                {item.ready ? "Ready" : "Setup needed"}
              </Badge>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">THE SOURCE DESK</p>
            <h2>Racing information sources</h2>
            <p className="source-help">
              Enable public or authorised sources after reviewing their access
              terms.
            </p>
          </div>
          <button
            className="button secondary small"
            onClick={() => setAdding(!adding)}
          >
            {adding ? <X size={14} /> : <Plus size={14} />}
            {adding ? "Cancel" : "Add source"}
          </button>
        </div>
        {adding ? (
          <form className="source-form" onSubmit={submit}>
            <div className="form-grid">
              <label>
                Source name
                <input
                  name="name"
                  placeholder="e.g. Racing authority news"
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Source URL
                <input name="url" type="url" placeholder="https://…" required />
              </label>
              <label>
                Source type
                <select name="type">
                  <option value="official">Official racing body</option>
                  <option value="publication">Industry publication</option>
                  <option value="data">Racing records / data</option>
                  <option value="social">Public social source</option>
                  <option value="media">Media source</option>
                </select>
              </label>
              <label>
                Adapter
                <select name="adapter">
                  <option value="rss">RSS / Atom feed</option>
                  <option value="html">Public HTML page</option>
                </select>
              </label>
              <label>
                Jurisdiction
                <input
                  name="jurisdiction"
                  placeholder="e.g. NSW, Australia"
                  required
                  defaultValue="Australia"
                />
              </label>
            </div>
            <div className="source-form-footer">
              <p>
                Use a legitimate public source that permits automated access.
              </p>
              <button className="button primary small" disabled={busy}>
                {busy ? "Saving…" : "Save source"}
                <Check size={14} />
              </button>
            </div>
          </form>
        ) : null}
        {config.sources?.length ? (
          <div className="configured-sources">
            {config.sources.map((source, index) => (
              <div
                className="configured-source"
                key={source.id || `${source.url}-${index}`}
              >
                <span className="source-icon">
                  <Globe2 size={18} />
                </span>
                <div>
                  <strong>{source.name}</strong>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.url}
                    <ExternalLink size={12} />
                  </a>
                  <p>
                    {words(source.type)} · {source.adapter.toUpperCase()} ·{" "}
                    {source.jurisdiction || "Unspecified jurisdiction"}
                  </p>
                </div>
                <div className="source-control">
                  <button
                    className={`toggle ${source.enabled ? "on" : ""}`}
                    role="switch"
                    aria-checked={source.enabled}
                    aria-label={`${source.enabled ? "Disable" : "Enable"} ${source.name}`}
                    disabled={busy || !source.id}
                    onClick={() =>
                      source.id && onToggle(source.id, !source.enabled)
                    }
                  >
                    <span />
                  </button>
                  <small>{source.enabled ? "Enabled" : "Disabled"}</small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={Radio} title="Build your source roster">
            Add an official racing feed or permitted public page to begin
            gathering live material. Demo fixtures work without a connection.
          </Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">READER RELATIONSHIPS</p>
            <h2>Correspondence & corrections</h2>
          </div>
          <Mail size={21} />
        </div>
        <div className="settings-copy">
          <dl>
            <div>
              <dt>Public contact address</dt>
              <dd>{config.contactEmail || "Awaiting confirmation"}</dd>
            </div>
            <div>
              <dt>Inbound handling</dt>
              <dd>
                Preserve the original message, create a private lead and
                prioritise corrections.
              </dd>
            </div>
            <div>
              <dt>Publication standard</dt>
              <dd>
                Subscriber and reader claims require the same evidence checks as
                every other source.
              </dd>
            </div>
          </dl>
          <p className="quiet">
            The reader contact address is separate from platform account
            identities and any verified delivery domain.
          </p>
        </div>
      </section>
    </div>
  );
}

function StoryReview({
  story,
  state,
  busy,
  error,
  close,
  onDecision,
}: {
  story: Story;
  state: NewsroomState;
  busy: boolean;
  error: string;
  close: () => void;
  onDecision: (
    decision: "approve" | "reject" | "send_back",
    note: string,
    wagering: boolean,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState("Article");
  const [note, setNote] = useState("");
  const [wagering, setWagering] = useState(false);
  const [validation, setValidation] = useState("");
  const [traceIds, setTraceIds] = useState<string[]>([]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const reviewable = ["waiting_approval", "blocked", "sent_back"].includes(
    story.status,
  );
  const tasks = state.tasks.filter((task) => task.storyId === story.id);
  const sources = state.sourceItems.filter((item) =>
    story.sourceItems.includes(item.id),
  );
  const displayMedia = story.media.length
    ? story.media
    : sources.flatMap((source) => source.media ?? []);
  const canApprove =
    story.status === "waiting_approval" && (!story.wagering || wagering);
  async function decision(value: "approve" | "reject" | "send_back") {
    if (value === "send_back" && !note.trim()) {
      setValidation(
        "Describe the specific changes or evidence needed before sending this story back.",
      );
      return;
    }
    setValidation("");
    await onDecision(value, note, wagering);
  }
  return (
    <dialog
      ref={dialog}
      className="review-dialog"
      aria-labelledby="review-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="review-header">
        <div>
          <p className="eyebrow">JAMES’S APPROVAL PACKAGE</p>
          <div className="review-header-status">
            <StoryBadge story={story} />
            {story.mode === "demo" ? <Badge>Private demo fixture</Badge> : null}
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="Close approval package"
          disabled={busy}
          onClick={close}
        >
          <X size={21} />
        </button>
      </div>
      <div className="review-title">
        <p className="eyebrow">
          {PE_AGENTS.find((agent) => agent.id === story.peAgentId)?.name}
        </p>
        <h2 id="review-title">{story.draft?.headline || story.title}</h2>
        <p>
          {story.draft?.byline || `Assigned to Agent ${story.peAgentId}`}
          <span>·</span>
          {dateTime(story.updatedAt)}
        </p>
      </div>
      <div className="review-section">
        <a
          className="button secondary small"
          href={`/editorial/${encodeURIComponent(story.id)}`}
        >
          Edit draft, resolve gaps &amp; record reply →
        </a>
      </div>
      <div
        className="review-tabs"
        role="group"
        aria-label="Approval package views"
      >
        {["Article", "Evidence", "Research", "Audit trail"].map((name) => (
          <button
            className={tab === name ? "selected" : ""}
            key={name}
            onClick={() => setTab(name)}
          >
            {name}
            {name === "Evidence" ? <span>{story.claims.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="review-body">
        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}
        {story.error ? (
          <div className="notice danger">
            <AlertTriangle size={17} />
            <span>{story.error}</span>
          </div>
        ) : null}
        {tab === "Article" ? (
          <>
            <div className="selection-reason">
              <p className="eyebrow">WHY THIS STORY WAS SELECTED</p>
              <p>{story.selectedReason || story.summary}</p>
            </div>
            {story.draft ? (
              <div className="draft-body">
                {story.draft.sentences.map((sentence, index) => (
                  <p key={index}>
                    {sentence.text}{" "}
                    {sentence.claimIds.length ? (
                      <button
                        className="trace-button"
                        aria-label={`Trace evidence for paragraph ${index + 1}`}
                        onClick={() => {
                          setTraceIds(sentence.claimIds);
                          setTab("Evidence");
                        }}
                      >
                        <Database size={12} />
                        {sentence.claimIds.length}
                      </button>
                    ) : null}
                  </p>
                ))}
              </div>
            ) : (
              <Empty icon={FileText} title="Draft not ready">
                The story must clear its research requirements before an
                editorial draft is prepared.
              </Empty>
            )}
            {story.draft?.limitations.length ? (
              <div className="review-section">
                <h3>Qualifications & limitations</h3>
                <ul className="plain-list">
                  {story.draft.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="review-section">
              <h3>Pre-publication checks</h3>
              {story.compliance.length ? (
                story.compliance.map((check) => (
                  <div className="compliance-row" key={check.id}>
                    <Badge
                      tone={
                        check.status === "passed"
                          ? "green"
                          : check.status === "blocked"
                            ? "pink"
                            : check.status === "warning"
                              ? "orange"
                              : "grey"
                      }
                    >
                      {words(check.status)}
                    </Badge>
                    <div>
                      <strong>{words(check.gate)}</strong>
                      <p>{check.message}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="quiet">Compliance has not run yet.</p>
              )}
            </div>
            <div className="review-section">
              <h3>Images & media</h3>
              {displayMedia.length ? (
                displayMedia.map((media) => (
                  <div className="media-record" key={media.id}>
                    <div className="media-record-grid">
                      <a className="media-thumbnail" href={media.url} target="_blank" rel="noopener noreferrer" aria-label={`Open image: ${media.proposedCaption || "attached media"}`}>
                        <Image loader={({ src }) => src} unoptimized src={media.url} alt={media.proposedCaption || "Attached story image"} width={240} height={150} />
                      </a>
                      <div><div className="media-record-heading">
                        <strong>{media.proposedCaption || "No proposed caption"}</strong>
                        <Badge tone={media.allowed ? "green" : "orange"}>{media.allowed ? "Cleared for use" : "Preview only"}</Badge>
                      </div><dl className="compact-dl">
                      <div>
                        <dt>Earliest source</dt>
                        <dd>{media.earliestSource || "Unknown"}</dd>
                      </div>
                      <div>
                        <dt>Date / location</dt>
                        <dd>
                          {media.date || "Unknown"} /{" "}
                          {media.location || "Unknown"}
                        </dd>
                      </div>
                      <div>
                        <dt>Context / caption</dt>
                        <dd>
                          {media.context} /{" "}
                          {media.captionSupported
                            ? "Supported"
                            : "Not supported"}
                        </dd>
                      </div>
                      <div>
                        <dt>Manipulation / AI</dt>
                        <dd>
                          {words(media.manipulation)} / {words(media.aiStatus)}
                        </dd>
                      </div>
                      <div>
                        <dt>Rights / reuse</dt>
                        <dd>
                          {media.rights} /{" "}
                          {media.reuseHistory.length
                            ? media.reuseHistory.join(", ")
                            : "No recorded reuse"}
                        </dd>
                      </div>
                      </dl></div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="quiet">No imagery attached to this package.</p>
              )}
            </div>
            {story.draft && displayMedia.length ? (
              <div className="review-section newspaper-preview">
                <div className="newspaper-preview-heading"><div><p className="eyebrow">NEWSPAPER PREVIEW</p><h3>How it will look in the paper</h3></div><Badge tone={displayMedia[0].allowed ? "green" : "orange"}>{displayMedia[0].allowed ? "Publication image" : "Layout preview · rights pending"}</Badge></div>
                <figure>
                  <Image loader={({ src }) => src} unoptimized src={displayMedia[0].url} alt={displayMedia[0].proposedCaption || story.draft.headline} width={900} height={520} />
                  <figcaption>{story.draft.captions?.find(caption => caption.mediaId === displayMedia[0].id)?.text || displayMedia[0].proposedCaption || `Image accompanying “${story.draft.headline}”.`} <span>Source: {sources.find(source => source.id === displayMedia[0].sourceId)?.sourceName || "Archived source"}</span></figcaption>
                </figure>
                <p className="paper-kicker">{PE_AGENTS.find(agent => agent.id === story.peAgentId)?.name}</p>
                <h2>{story.draft.headline}</h2>
                {story.draft.deck ? <p className="newspaper-preview-deck">{story.draft.deck}</p> : null}
                <p className="newspaper-preview-byline">{story.draft.byline}</p>
              </div>
            ) : null}
          </>
        ) : null}
        {tab === "Evidence" ? (
          <>
            <div className="trace-explainer">
              <Database size={19} />
              <span>
                Published sentence <ArrowRight size={12} /> Hub claim{" "}
                <ArrowRight size={12} /> Research evidence{" "}
                <ArrowRight size={12} /> Original source
              </span>
            </div>
            {traceIds.length ? (
              <div className="notice informational">
                <span>Highlighted claims support the selected passage.</span>
                <button className="text-link" onClick={() => setTraceIds([])}>
                  Clear highlight
                </button>
              </div>
            ) : null}
            <div className="claim-list">
              {story.claims.map((claim) => (
                <ClaimCard
                  key={`${claim.id}-${traceIds.includes(claim.id)}`}
                  claim={claim}
                  sources={state.sourceItems}
                  highlight={traceIds.includes(claim.id)}
                />
              ))}
            </div>
            <div className="review-section">
              <h3>Original sources</h3>
              {sources.map((source) => (
                <div key={source.id} className="review-source">
                  <Badge
                    tone={
                      source.type === "official"
                        ? "green"
                        : source.type === "email"
                          ? "purple"
                          : "grey"
                    }
                  >
                    {source.type}
                  </Badge>
                  <div>
                    <strong>{source.title}</strong>
                    <p>
                      {source.sourceName} · {dateTime(source.publishedAt)}
                    </p>
                    {source.url.startsWith("https://") ||
                    source.url.startsWith("http://") ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open original source <ArrowUpRight size={12} />
                      </a>
                    ) : (
                      <span className="quiet">
                        Private source preserved in the hub
                      </span>
                    )}
                    <p className="mono">{source.id}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {tab === "Research" ? (
          <>
            <div className="review-section first">
              <h3>Research assignments</h3>
              <p className="quiet">
                Multiple specialists contribute evidence to this shared story
                package.
              </p>
              {tasks.map((task) => (
                <div className="task-card" key={task.id}>
                  <div>
                    <strong>
                      R{task.agentId} ·{" "}
                      {
                        RESEARCH_AGENTS.find(
                          (agent) => agent.id === task.agentId,
                        )?.name
                      }
                    </strong>
                    <Badge
                      tone={
                        task.status === "completed"
                          ? "green"
                          : task.status === "failed"
                            ? "pink"
                            : "blue"
                      }
                    >
                      {task.status}
                    </Badge>
                  </div>
                  <p>{task.question}</p>
                  <small>
                    Round {task.round} · {task.attempts} attempt
                    {task.attempts !== 1 ? "s" : ""} ·{" "}
                    {dateTime(task.createdAt)}
                  </small>
                  {task.error ? (
                    <p className="error-text">{task.error}</p>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="review-section">
              <h3>Completeness & targeted follow-up</h3>
              {story.gaps.length ? (
                story.gaps.map((gap) => (
                  <div className="gap-row" key={gap.id}>
                    <Badge
                      tone={gap.status === "resolved" ? "green" : "orange"}
                    >
                      {gap.status}
                    </Badge>
                    <div>
                      <strong>{gap.question}</strong>
                      <p>
                        Research Agent {gap.agentId} ·{" "}
                        {gap.blocking
                          ? "Required before drafting"
                          : "Qualified limitation"}
                      </p>
                      {gap.resolution ? (
                        <p className="gap-resolution">{gap.resolution}</p>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="quiet">No evidence gaps recorded.</p>
              )}
            </div>
            <div className="review-section">
              <h3>Structured findings</h3>
              {story.findings.map((finding) => (
                <div className="finding" key={finding.id}>
                  <Badge tone="blue">Research Agent {finding.agentId}</Badge>
                  <p>{finding.summary}</p>
                  <p className="mono">
                    {finding.claimIds.length} linked claims · Task{" "}
                    {finding.taskId}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {tab === "Audit trail" ? (
          <>
            <AuditList
              events={state.audit
                .filter((event) => event.storyId === story.id)
                .slice()
                .reverse()}
            />
            <div className="review-section">
              <h3>Recorded editorial decisions</h3>
              {story.approvals.length ? (
                story.approvals.map((approval) => (
                  <div className="recorded-decision" key={approval.id}>
                    <strong>
                      {words(approval.decision)} · {approval.actor}
                    </strong>
                    <p>{approval.note || "No additional note."}</p>
                    <small>{dateTime(approval.createdAt)}</small>
                    <p className="mono">
                      Draft: {approval.draftHash || "No draft"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="quiet">No decision has been made.</p>
              )}
            </div>
          </>
        ) : null}
      </div>
      <div className="decision-panel">
        {reviewable ? (
          <>
            <label htmlFor="decision-note">
              Editorial note <span>Required for Send back</span>
            </label>
            <textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Describe a correction, an evidence gap or your reason for this decision…"
              rows={2}
              maxLength={3000}
              disabled={busy}
            />
            {story.wagering ? (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={wagering}
                  onChange={(event) => setWagering(event.target.checked)}
                />
                <span>
                  I have reviewed the current wagering policy, jurisdiction and
                  compliance flags for this exact draft.
                </span>
              </label>
            ) : null}
            {validation ? (
              <p className="error-text" role="alert">
                {validation}
              </p>
            ) : null}
            <div className="decision-actions">
              <p>
                <ShieldCheck size={14} />
                {story.mode === "demo"
                  ? "Demo approval stays private."
                  : "Approval publishes this exact draft."}
              </p>
              <button
                className="button ghost small"
                disabled={busy}
                onClick={() => decision("reject")}
              >
                Reject
              </button>
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => decision("send_back")}
              >
                Send back
              </button>
              <button
                className="button primary small"
                disabled={busy || !canApprove}
                onClick={() => decision("approve")}
              >
                <Check size={15} />
                {busy
                  ? "Saving…"
                  : story.mode === "demo"
                    ? "Approve demo"
                    : "Approve & publish"}
              </button>
            </div>
            {story.status !== "waiting_approval" ? (
              <p className="quiet">
                Approval remains disabled until the story returns to the
                approval gate.
              </p>
            ) : null}
          </>
        ) : (
          <div className="decision-complete">
            <ShieldCheck size={19} />
            <p>
              {story.status === "published"
                ? story.mode === "demo"
                  ? "Demo approval recorded. This article is excluded from the public edition."
                  : "This story has been approved and published."
                : story.status === "rejected"
                  ? "This story was rejected. Its evidence and decision history are preserved."
                  : "This story is being prepared. Review becomes available at the approval gate."}
            </p>
            <button className="button secondary small" onClick={close}>
              Close package
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
