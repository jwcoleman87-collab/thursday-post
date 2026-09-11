"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PaperFooter, PaperHeader } from "@/components/publication-brand";
import { PE_AGENTS, type NewsroomState, type Story } from "@/lib/domain";

type Payload = { state: NewsroomState };
const status = (story: Story) => story.status === "published" ? "Approved" : "Awaiting your approval";

function ProofStory({ story, lead = false }: { story: Story; lead?: boolean }) {
  const media = story.media[0];
  const desk = PE_AGENTS.find((agent) => agent.id === story.peAgentId)?.name;
  return <article className={`paper-story next-proof-story ${lead ? "paper-lead" : ""}`}>
    <div className="next-proof-meta"><p className="paper-kicker">{desk}</p><span>{status(story)}</span></div>
    {media ? <figure className="next-proof-image"><Image loader={({ src }) => src} unoptimized src={media.url} alt={media.proposedCaption || story.draft!.headline} width={900} height={520} /><figcaption>{media.proposedCaption || "Image attached to this story."}{!media.allowed ? " · Layout preview; usage rights pending." : ""}</figcaption></figure> : null}
    <h2>{story.draft!.headline}</h2>
    {story.draft!.deck ? <p className="paper-deck">{story.draft!.deck}</p> : null}
    <p className="paper-excerpt">{story.draft!.sentences[0]?.text}</p>
    <p className="paper-byline">By {story.draft!.byline.replace(/^By\s+/i, "")}</p>
    <Link className="paper-continue" href={`/newsroom?story=${encodeURIComponent(story.id)}`}>Open approval package ↗</Link>
  </article>;
}

export default function NextIssuePreview() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/newsroom", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (response.status === 401) throw new Error("Sign in as James to view the private issue proof.");
      if (!response.ok) throw new Error("The issue proof could not be opened.");
      return response.json();
    }).then(setData).catch((reason) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, []);
  const stories = (data?.state.stories ?? []).filter((story) => story.mode === "live" && story.draft && ["waiting_approval", "published"].includes(story.status)).sort((a, b) => Number(b.status === "published") - Number(a.status === "published") || b.updatedAt.localeCompare(a.updatedAt));
  return <main className="paper next-proof"><PaperHeader /><div className="paper-dateline"><Link href="/newsroom">← EDITOR’S WORKSPACE</Link><span>NEXT THURSDAY · WORK IN PROGRESS</span><span>PRIVATE PROOF</span></div>
    <section className="next-proof-banner"><div><p className="paper-kicker">NEXT ISSUE SO FAR</p><h1>The paper taking shape.</h1><p>This is a live progress proof. It changes as stories clear research and receive your final approval.</p></div><div><strong>{stories.length}</strong><span>{stories.length === 1 ? "story" : "stories"} in this proof</span><small>{stories.filter((story) => story.status === "published").length} approved</small></div></section>
    {error ? <section className="paper-message" role="alert"><h1>Private proof unavailable</h1><p>{error}</p><Link href="/newsroom">Return to the newsroom</Link></section> : !data ? <p className="paper-message" role="status">Laying out next Thursday’s paper…</p> : stories.length ? <div className="paper-front next-proof-grid"><div className="paper-main-column"><ProofStory story={stories[0]} lead />{stories[2] ? <ProofStory story={stories[2]} /> : null}</div><div className="paper-second-column">{stories[1] ? <ProofStory story={stories[1]} /> : <section className="paper-editorial-note"><p className="paper-kicker">ROOM TO GROW</p><h2>The next approved story will appear here.</h2><p>This proof expands automatically as the newsroom progresses.</p></section>}</div><aside className="paper-briefs"><p className="paper-column-label">PROGRESS DESK</p>{stories.slice(3).map((story) => <ProofStory key={story.id} story={story} />)}<section><h2>Not the final edition.</h2><p>Story order, imagery, captions and headlines remain open until the edition is reviewed and released.</p></section></aside></div> : <section className="paper-opening"><div><p className="paper-kicker">NEXT ISSUE SO FAR</p><h1>A clean page, for now.</h1><p className="paper-deck">Approved and approval-ready live stories will assemble here automatically.</p><Link className="paper-button" href="/newsroom">Return to the newsroom ↗</Link></div></section>}<PaperFooter />
  </main>;
}
