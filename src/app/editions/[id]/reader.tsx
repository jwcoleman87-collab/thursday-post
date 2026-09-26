'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HeardSomething, PaperFooter, PaperHeader } from '@/components/publication-brand';
import EditionPages from '@/components/edition-pages';
import type { EditionArticle, EditionPage } from '@/lib/edition-types';
type ContentsArticle = Pick<EditionArticle, 'publicationId' | 'headline' | 'byline'> & { section?: string };
type ReaderEdition = { id: string; number: number; date: string; title: string; preview: string; withdrawnCount: number; articles: (ContentsArticle & Partial<EditionArticle>)[]; pageCount?: number; pages?: { number: number; section: string }[]; layout?: EditionPage[]; readiness?: { ready: boolean; message: string }; status?: string };
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });
export default function EditionReader({ id }: { id: string }) {
  const [result, setResult] = useState<{ edition: ReaderEdition; entitled: boolean }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/editions/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || 'The edition could not be opened.'); return value; }).then(setResult).catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); });
    return () => controller.abort();
  }, [id]);
  const edition = result?.edition;
  const full = Boolean(result?.entitled && edition?.layout && edition.articles.every(article => article.paragraphs));
  return <main className="paper reader-paper"><PaperHeader /><div className="paper-dateline"><Link href="/editions">← EDITION ARCHIVE</Link><span>{edition ? `NO. ${edition.number} · ${dateLabel(edition.date)}${edition.pageCount ? ` · ${edition.pageCount} PAGES` : ''}` : 'THE THURSDAY EDITION'}</span><Link href="/member">Your account ↗</Link></div>
    {error ? <section className="paper-message"><h1>Edition unavailable</h1><p role="alert">{error}</p><Link href="/editions">Browse the edition archive</Link></section> : !edition || !result ? <p className="paper-message" role="status">Opening the edition…</p> : <>
      {edition.status === 'draft' ? <aside className="paper-correction" role="status"><strong>Draft preview — only you can see this.</strong><p>{edition.readiness?.message}</p></aside> : null}
      <header className="reader-heading reader-edition-heading"><p className="paper-kicker">THE THURSDAY EDITION · NO. {edition.number}</p><h1>{edition.title}</h1><p>{edition.preview}</p>{edition.withdrawnCount > 0 ? <aside className="paper-correction"><strong>Editorial notice</strong><p>{edition.withdrawnCount} {edition.withdrawnCount === 1 ? 'article has' : 'articles have'} been withdrawn following editorial review.</p><Link href="/corrections">Corrections &amp; updates ↗</Link></aside> : null}</header>
      {full ? <><div className="reader-toolbar"><span className="paper-kicker">THE COMPLETE EDITION · {edition.layout!.length} PAGES</span><button className="paper-button reader-button-outline" onClick={() => window.print()}>Print or save as PDF</button></div>
        <EditionPages pages={edition.layout!} edition={{ number: edition.number, date: edition.date }} articles={edition.articles.map(article => ({ publicationId: article.publicationId, headline: article.headline, byline: article.byline, paragraphs: article.paragraphs ?? [], section: article.section, deck: article.deck, label: article.label, publishedAt: article.publishedAt, images: article.images, sources: article.sources, limitations: article.limitations }))} /></>
      : <div className="reader-edition-layout"><section className="paper-paywall reader-edition-paywall"><p className="paper-kicker">CONTINUE WITH THURSDAY POST</p><h2>The complete paper.<br />A considered Thursday.</h2><p>This edition is for subscribers. Sign in to read the full reporting, pictures and sources.</p><Link className="paper-button" href="/member">Subscriber sign in ↗</Link><Link href="/subscribe">See the subscription</Link></section>
        <aside className="reader-margin reader-contents"><p className="paper-column-label">IN THIS EDITION</p>{edition.pages?.length ? <p className="paper-byline">{edition.pages.length} pages: {edition.pages.map(page => page.section).filter((section, index, all) => all.indexOf(section) === index).join(' · ')}</p> : null}<ol>{edition.articles.map((article, index) => <li key={article.publicationId}><span className="reader-contents-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{article.headline}</h3><p className="paper-byline">{article.section ? `${article.section} · ` : ''}By {article.byline.replace(/^By\s+/i, '')}</p></div></li>)}</ol>{!edition.articles.length ? <p>No articles remain available in this edition.</p> : null}<div className="paper-rule" /><Link className="paper-continue" href="/editions">Browse past editions ↗</Link></aside></div>}
    </>}
    <HeardSomething /><PaperFooter /></main>;
}
