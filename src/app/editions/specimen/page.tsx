import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { HeardSomething, PaperFooter, PaperHeader } from '@/components/publication-brand';
import EditionPages from '@/components/edition-pages';
import { composeEdition } from '@/lib/edition-layout';
import { findLicensedImages, type PictureFetch } from '@/lib/picture-desk';
import { SPECIMEN_NOTE, specimenArticles } from '@/lib/specimen-edition';
import '../edition.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Specimen edition', robots: { index: false, follow: false } };

/** Only for layout review: preview deployments and local runs that opt in. Never in production. */
function specimenEnabled() {
  return process.env.VERCEL_ENV === 'preview' || (process.env.NEWSROOM_SPECIMEN === 'true' && process.env.VERCEL_ENV !== 'production');
}
/** Picture lookups for the specimen are cached for a day; the database is never touched. */
const cachedFetch: PictureFetch = (url, init) => fetch(url, { ...init, cache: 'force-cache', next: { revalidate: 86_400 } } as RequestInit);

export default async function SpecimenEdition() {
  if (!specimenEnabled()) notFound();
  const deadline = Date.now() + 20_000;
  const articles = await Promise.all(specimenArticles.map(async article => ({
    ...article,
    limitations: article.fictional ? ['Specimen text: fictional story written to review the page layout. Not reporting.'] : ['Archive feature written for the specimen edition from well-documented history.'],
    images: article.pictureTerms.length ? await findLicensedImages(article, { terms: article.pictureTerms, deadline, fetch: cachedFetch }) : [],
  })));
  const pages = composeEdition(articles);
  const pictures = articles.reduce((total, article) => total + article.images.length, 0);
  return <main className="paper reader-paper"><PaperHeader />
    <div className="paper-dateline"><span>SPECIMEN EDITION · NOT FOR PUBLICATION</span><span>NO. 0 · {pages.length} PAGES</span><span>{pictures} LICENSED PICTURES FOUND</span></div>
    <aside className="paper-correction" role="note"><strong>Specimen edition</strong><p>{SPECIMEN_NOTE}</p></aside>
    <header className="reader-heading reader-edition-heading"><p className="paper-kicker">THE THURSDAY EDITION · SPECIMEN</p><h1>Country racing’s good week</h1><p>A mare who paid for the fences, stewards asking who makes the phone call, and the three museums that share Phar Lap.</p></header>
    <EditionPages pages={pages} edition={{ number: 0, date: '2026-10-01' }} articles={articles} />
    <HeardSomething /><PaperFooter /></main>;
}
