"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BookOpen, Mail } from "lucide-react";

type PublicArticle = {
  id: string; headline: string; byline: string; section: string; publishedAt: string;
  paragraphs: { text: string; claimIds: string[] }[];
  sources: { title: string; url: string }[];
  limitations?: string[];
};
type Edition = { articles: PublicArticle[]; contactEmail: string };

function publicationDate(value: string) {
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney" });
}

export default function PublicEdition({ articleId }: { articleId?: string }) {
  const [edition, setEdition] = useState<Edition | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public", { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("The newspaper could not be loaded. Please try again."); return response.json(); })
      .then(setEdition)
      .catch(error => { if (error.name !== "AbortError") setError(error.message); });
    return () => controller.abort();
  }, []);
  const article = edition?.articles.find(item => item.id === articleId);
  return <main className="public-page">
    <div className="edition-top"><span>Australian thoroughbred racing</span><Link href="/">Newsroom <ArrowUpRight size={14} /></Link></div>
    <header className="masthead"><p className="eyebrow">Evidence first. Racing always.</p><Link href="/news"><h1>The Racing Desk<span>.</span></h1></Link><p>People, policy and the stories behind the sport.</p></header>
    <div className="edition-rule"><span>THE NEWSPAPER</span><span>Researched. Traced. Reviewed.</span></div>
    {error ? <div className="notice danger" role="alert">{error}</div> : !edition ? <div className="empty-state"><span className="spinner" /><p>Opening the newspaper…</p></div> : articleId ? article ? <article className="published-article">
      <Link className="text-link" href="/news"><ArrowLeft size={15} /> All stories</Link>
      <p className="eyebrow">{article.section}</p><h2>{article.headline}</h2>
      <div className="article-byline">By {article.byline}<span>·</span><time dateTime={article.publishedAt}>{publicationDate(article.publishedAt)}</time></div>
      <div className="article-body">{article.paragraphs.map((paragraph, index) => <p key={index}>{paragraph.text}</p>)}</div>
      {article.limitations?.length ? <aside className="article-sources"><h3>Reporting notes</h3>{article.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}</aside> : null}
      <aside className="article-sources"><h3>Behind this story</h3><p>Original sources supporting the reporting.</p>{article.sources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ArrowUpRight size={16} /></a>)}</aside>
    </article> : <div className="empty-state"><BookOpen size={32} /><h2>Story not available</h2><p>This story is not in the published edition.</p><Link className="button primary" href="/news">Back to the newspaper</Link></div> : edition.articles.length ? <div className="edition-grid">{edition.articles.map((item, index) => <article key={item.id} className={index === 0 ? "edition-story lead-story" : "edition-story"}><p className="eyebrow">{item.section}</p><Link href={`/news/${encodeURIComponent(item.id)}`}><h2>{item.headline}</h2></Link><p>{item.paragraphs[0]?.text}</p><div className="article-byline">By {item.byline}<span>·</span>{publicationDate(item.publishedAt)}</div><Link className="text-link" href={`/news/${encodeURIComponent(item.id)}`}>Read the story <ArrowUpRight size={16} /></Link></article>)}</div> : <div className="first-edition"><span className="edition-emblem"><BookOpen size={34} strokeWidth={1.4} /></span><p className="eyebrow">The first edition</p><h2>Good reporting starts<br />with the evidence.</h2><p>Our Australian thoroughbred racing newsroom is preparing its first stories. Every article is researched, traced to its sources and reviewed before publication.</p><div className="small-rule" /><p className="quiet">Published stories will appear here after editorial approval.</p></div>}
    <footer className="public-footer"><div><strong>The Racing Desk.</strong><p>Independent thinking. Accountable reporting.</p></div><div>{edition?.contactEmail ? <><a className="text-link" href={`mailto:${edition.contactEmail}`}><Mail size={16} /> Contact the newsroom</a><p>Tips, questions and corrections welcome.</p></> : <p>Reader correspondence is being configured.</p>}</div></footer>
  </main>;
}
