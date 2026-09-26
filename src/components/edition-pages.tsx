import Link from 'next/link';
import type { LicensedImage } from '@/lib/domain';
import type { EditionBlock, EditionPage } from '@/lib/edition-types';
import { creditLine, printableImages } from '@/lib/image-rights';

/**
 * Renders composed pages as a broadsheet: folio lines, column text, drop caps, captioned pictures
 * with credits, pull quotes, fact panels and briefs rails. Everything printed comes from the
 * approved article or the picture's own provenance; nothing is invented to fill space.
 */

export interface PageArticle {
  publicationId: string;
  headline: string;
  byline: string;
  paragraphs: string[];
  section?: string;
  deck?: string;
  label?: string;
  publishedAt?: string;
  images?: LicensedImage[];
  sources?: { title: string; url: string }[];
  limitations?: string[];
  locked?: boolean;
  href?: string;
}

type Mode = 'edition' | 'front';
const byline = (value: string) => value.replace(/^By\s+/i, '');
const dateLabel = (value?: string) => value ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' }) : '';
const kicker = (article: PageArticle) => article.label ? article.label.replaceAll('_', ' ') : article.section ?? 'The Post';

/** Figures already stated in the article — money, distances, ages, counts — with their own words. */
export function factsFor(paragraphs: string[]): { figure: string; context: string }[] {
  const text = paragraphs.join(' ');
  const facts: { figure: string; context: string }[] = [];
  const pattern = /(\$\d[\d,.]*(?:\s?(?:million|m|k))?|\b\d[\d,]*\s?m\b|\b\d{1,3}(?=\s(?:years?|starts?|wins?|races?|runners?|horses?|winners?|metres|lengths?))|\b\d{1,2}(?:st|nd|rd|th)\b)/gi;
  for (const match of text.matchAll(pattern)) {
    if (facts.length >= 3) break;
    const figure = match[0].trim();
    if (facts.some(fact => fact.figure === figure)) continue;
    const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, match.index! - 45)));
    const end = text.indexOf(' ', Math.min(text.length, match.index! + figure.length + 55));
    const context = text.slice(start, end < 0 ? undefined : end).replace(/^[^A-Za-z$0-9“"]+/, '').trim();
    facts.push({ figure, context: `…${context}…` });
  }
  return facts;
}

export function Figure({ image, size }: { image: LicensedImage; size: 'hero' | 'wide' | 'column' | 'inset' }) {
  const prefix = image.relevance === 'subject' ? '' : image.relevance === 'venue' ? 'File photo: ' : 'File photo: ';
  const portrait = image.height > image.width * 1.05;
  return <figure className={`ed-figure ed-figure-${size}${portrait ? ' ed-figure-portrait' : ''}`}>
    <div className="ed-figure-frame"><img src={image.url} width={image.width} height={image.height} alt={image.alt} loading="lazy" decoding="async" /></div>
    <figcaption><span className="ed-caption">{prefix}{image.caption}</span> <span className="ed-credit">{creditLine(image)}. <a href={image.sourcePage} target="_blank" rel="noopener noreferrer">Source &amp; licence</a></span></figcaption>
  </figure>;
}

function PullQuote({ text, byline: author }: { text: string; byline?: string }) {
  return <blockquote className="ed-pullquote"><p>“{text}”</p>{author ? <cite>{author}</cite> : null}</blockquote>;
}

/** Years the story itself names, each with its own words, for a timeline panel. */
export function timelineFor(paragraphs: string[]): { year: string; context: string }[] {
  const entries: { year: string; context: string }[] = [];
  for (const sentence of paragraphs.join(' ').split(/(?<=[.!?”])\s+/)) {
    const year = sentence.match(/\b(1[89]\d{2}|20\d{2})\b/)?.[1];
    if (!year || entries.some(entry => entry.year === year) || entries.length >= 4) continue;
    entries.push({ year, context: sentence.length > 150 ? `${sentence.slice(0, 147).replace(/\s+\S*$/, '')}…` : sentence });
  }
  return entries.sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * The designed treatment for a major story without a legitimate picture: its strongest quotation,
 * its own figures, or its own dates. Every word comes from the approved text; if the story offers
 * none of these, no panel is drawn rather than repeating the text.
 */
function TypePanel({ article, quote }: { article: PageArticle; quote?: string }) {
  const facts = factsFor(article.paragraphs);
  const timeline = timelineFor(article.paragraphs);
  if (quote) return <aside className="ed-typepanel ed-typepanel-quote" aria-label="From the story"><span className="ed-typepanel-mark" aria-hidden="true">“</span><p>{quote}</p><span className="ed-typepanel-rule" /></aside>;
  if (facts.length >= 2) return <aside className="ed-typepanel ed-typepanel-facts" aria-label="The figures"><p className="ed-panel-label">The figures</p><dl>{facts.map(fact => <div key={fact.figure}><dt>{fact.figure}</dt><dd>{fact.context}</dd></div>)}</dl></aside>;
  if (timeline.length >= 2) return <aside className="ed-typepanel ed-typepanel-facts ed-typepanel-timeline" aria-label="Timeline"><p className="ed-panel-label">Timeline</p><dl>{timeline.map(entry => <div key={entry.year}><dt>{entry.year}</dt><dd>{entry.context}</dd></div>)}</dl></aside>;
  return null;
}

function Headline({ article, level }: { article: PageArticle; level: 'h2' | 'h3' }) {
  const Tag = level;
  return <Tag className="ed-headline">{article.href ? <Link href={article.href}>{article.headline}</Link> : article.headline}</Tag>;
}

function Body({ article, mode, quote, columns, insetImage, limit, jumpTo }: { article: PageArticle; mode: Mode; quote?: string; columns: number; insetImage?: LicensedImage; limit?: number; jumpTo?: number }) {
  const paragraphs = mode === 'front' || jumpTo ? article.paragraphs.slice(0, jumpTo ? 2 : limit ?? 1) : article.paragraphs;
  const quoteAfter = Math.min(2, Math.max(0, paragraphs.length - 2));
  return <div className={`ed-body ed-cols-${columns}`}>
    {paragraphs.map((paragraph, index) => <div key={index} className="ed-para-wrap">
      <p className={index === 0 ? 'ed-first' : undefined}>{paragraph}</p>
      {quote && index === quoteAfter && paragraphs.length > 2 ? <PullQuote text={quote} /> : null}
      {insetImage && index === 0 && paragraphs.length > 2 ? <Figure image={insetImage} size="inset" /> : null}
    </div>)}
    {article.locked ? <p className="ed-locked">The full report is for subscribers. <Link href="/member">Sign in</Link> or <Link href="/subscribe">subscribe</Link>.</p> : null}
    {jumpTo ? <a className="ed-continue ed-jump" href={`#story-${article.publicationId}`}>Continued on page {jumpTo} →</a> : mode === 'front' && article.href && !article.locked ? <Link className="ed-continue" href={article.href}>Continue reading ↗</Link> : null}
  </div>;
}

function Record({ article }: { article: PageArticle }) {
  if (!article.sources?.length && !article.limitations?.length) return null;
  return <details className="ed-record"><summary>On the record</summary>{article.limitations?.map((note, index) => <p key={index}>{note}</p>)}{article.sources?.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</details>;
}

function Story({ article, block, mode, page, panel }: { article: PageArticle; block: EditionBlock; mode: Mode; page: EditionPage; panel: boolean }) {
  const images = printableImages(article.images);
  const image = block.imageIndex !== undefined ? images[block.imageIndex] : undefined;
  const inset = block.insetIndex !== undefined ? images[block.insetIndex] : undefined;
  const id = block.teaser ? undefined : `story-${article.publicationId}`;
  const jumpTo = mode === 'edition' && block.teaser ? block.jumpTo : undefined;
  const label = block.continuedFrom ? `${kicker(article)} · Continued from page ${block.continuedFrom}` : kicker(article);
  const meta = <p className="ed-byline">By {byline(article.byline)}{article.publishedAt ? <> <span aria-hidden="true">·</span> <time dateTime={article.publishedAt}>{dateLabel(article.publishedAt)}</time></> : null}</p>;
  if (block.role === 'brief') return <article id={id} className="ed-story ed-brief"><p className="ed-kicker">{kicker(article)}</p><Headline article={article} level="h3" /><Body article={article} mode={mode} columns={1} limit={1} />{mode === 'edition' ? <Record article={article} /> : null}</article>;
  if (block.role === 'lead') {
    const wide = page.template === 'picture-led';
    return <article id={id} className={`ed-story ed-lead${wide ? ' ed-lead-wide' : ''}`}>
      {image ? <Figure image={image} size={wide || page.template === 'front' ? 'hero' : 'wide'} /> : null}
      <p className="ed-kicker">{label}</p>
      <Headline article={article} level="h2" />
      {article.deck ? <p className="ed-deck">{article.deck}</p> : null}
      {meta}
      {!image && panel ? <TypePanel article={article} quote={block.pullQuote} /> : null}
      <Body article={article} mode={mode} quote={image || !panel ? block.pullQuote : undefined} columns={wide ? 3 : 2} insetImage={inset} limit={3} />
      {mode === 'edition' ? <Record article={article} /> : null}
    </article>;
  }
  return <article id={id} className={`ed-story ed-${block.role}${block.teaser ? ' ed-teaser' : ''}`}>
    {image ? <Figure image={image} size={block.role === 'feature' ? 'wide' : 'column'} /> : null}
    <p className="ed-kicker">{label}</p>
    <Headline article={article} level="h3" />
    {article.deck ? <p className="ed-deck">{article.deck}</p> : null}
    {meta}
    {!image && panel ? <TypePanel article={article} quote={block.pullQuote} /> : null}
    <Body article={article} mode={mode} quote={block.role === 'feature' && !(panel && !image) ? block.pullQuote : undefined} columns={1} limit={1} jumpTo={jumpTo} />
    {mode === 'edition' && !block.teaser ? <Record article={article} /> : null}
  </article>;
}

function Folio({ page, edition, total }: { page: EditionPage; edition: { number?: number; date?: string }; total: number }) {
  return <header className="ed-folio"><span>THURSDAY POST</span><span>{edition.number ? `No. ${edition.number} · ` : ''}{dateLabel(edition.date)}</span><span>Page {page.number}{total ? ` of ${total}` : ''} · {page.section}</span></header>;
}

function Inside({ pages, articles }: { pages: EditionPage[]; articles: Map<string, PageArticle> }) {
  const later = pages.slice(1);
  if (!later.length) return null;
  return <nav className="ed-inside" aria-label="Inside this edition"><p className="ed-panel-label">Inside</p><ol>{later.map(page => {
    const lead = page.blocks.find(item => item.role !== 'brief') ?? page.blocks[0];
    const article = lead && articles.get(lead.publicationId);
    return <li key={page.number}><a href={`#page-${page.number}`}><span className="ed-inside-page">{page.number}</span><span className="ed-inside-section">{page.section}</span>{article ? <span className="ed-inside-headline">{article.headline}</span> : null}</a></li>;
  })}</ol></nav>;
}

export default function EditionPages({ pages, articles, edition, mode = 'edition' }: { pages: EditionPage[]; articles: PageArticle[]; edition: { number?: number; date?: string }; mode?: Mode }) {
  const byId = new Map(articles.map(article => [article.publicationId, article]));
  // On the website front, a teaser already links to its article, so the full printing inside is not repeated.
  const teased = new Set(mode === 'front' ? pages[0]?.blocks.filter(block => block.teaser).map(block => block.publicationId) : []);
  return <div className={`ed-edition ed-mode-${mode}`}>{pages.map(page => {
    const blocks = page.blocks.filter(block => byId.has(block.publicationId) && !(page.number > 1 && teased.has(block.publicationId)));
    if (!blocks.length) return null;
    const majors = blocks.filter(block => block.role !== 'brief');
    const briefs = blocks.filter(block => block.role === 'brief');
    const [first, ...rest] = majors;
    // One typographic panel per page at most, for the first major story that has no picture.
    const pictured = (block: EditionBlock) => block.imageIndex !== undefined && printableImages(byId.get(block.publicationId)!.images)[block.imageIndex];
    const panelFor = majors.find(block => !block.teaser && !pictured(block))?.publicationId;
    const story = (block: EditionBlock) => <Story key={`${block.publicationId}${block.teaser ? '-teaser' : ''}`} article={byId.get(block.publicationId)!} block={block} mode={mode} page={page} panel={block.publicationId === panelFor && !block.teaser} />;
    // Placement by page shape: a main column, a rail holding at most one companion story, and a band below.
    const railCount = page.template === 'text-led' || page.template === 'features' || page.template === 'front' ? 1 : 0;
    const splitCount = page.template === 'split' ? 2 : 0;
    const head = page.template === 'split' ? majors.slice(0, splitCount) : first ? [first] : [];
    const rail = page.template === 'split' ? [] : rest.slice(0, railCount);
    const band = page.template === 'split' ? majors.slice(splitCount) : rest.slice(railCount);
    const inside = page.number === 1 && mode === 'edition' ? <Inside pages={pages} articles={byId} /> : null;
    return <section key={page.number} id={`page-${page.number}`} className={`ed-page ed-t-${page.template}`} aria-label={`Page ${page.number}: ${page.section}`}>
      {page.number > 1 || mode === 'edition' ? <Folio page={page} edition={edition} total={mode === 'edition' ? pages.length : 0} /> : null}
      {page.template === 'split'
        ? <div className="ed-grid ed-grid-split">{head.map(story)}</div>
        : page.template === 'picture-led'
          ? <div className="ed-wide">{head.map(story)}</div>
          : <div className="ed-grid">
              <div className="ed-main">{head.map(story)}</div>
              {rail.length || inside ? <div className="ed-side">{inside}{rail.map(story)}</div> : null}
            </div>}
      {band.length ? <div className={`ed-band ed-band-${Math.min(page.template === 'front' ? 3 : 2, band.length)}`}>{band.map(story)}</div> : null}
      {briefs.length ? <div className="ed-briefs"><p className="ed-panel-label">In brief</p><div className={`ed-briefs-row ed-briefs-${Math.min(4, briefs.length)}`}>{briefs.map(story)}</div></div> : null}
    </section>;
  })}</div>;
}
