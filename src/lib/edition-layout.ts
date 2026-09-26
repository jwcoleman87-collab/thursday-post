import type { LicensedImage } from './domain';
import type { EditionBlock, EditionPage, EditionPageTemplate } from './edition-types';
import { printableImages } from './image-rights';

/**
 * The make-up desk: arranges approved articles into newspaper pages the way an editor would.
 * It ranks stories, gives the front page one dominant lead with teasers that jump inside, groups
 * the rest into section pages, varies page shapes, places pictures and pull quotes, and never
 * invents content to fill space. Every story is printed in full exactly once.
 * Page count follows the material: thin material makes fewer pages, and the release gate says so.
 */

export const MINIMUM_SUBSTANTIAL_PAGES = 5;
const SUBSTANTIAL_PAGE_WORDS = 320;
const SUBSTANTIAL_STORY_WORDS = 110;
const BRIEF_WORDS = 95;
const MAX_MAJORS_PER_PAGE = 3;
const MAX_BRIEFS_PER_PAGE = 4;
const MAX_IMAGES_PER_PAGE = 4;

export interface ComposableArticle {
  publicationId: string;
  headline: string;
  paragraphs: string[];
  section?: string;
  deck?: string;
  label?: string;
  publishedAt?: string;
  images?: LicensedImage[];
}

export const wordCount = (paragraphs: string[]) => paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
const isNotice = (article: ComposableArticle) => article.label === 'correction' || article.label === 'update' || article.label === 'right_of_reply';

/** A direct quotation already in the approved text, short enough to set large. */
export function pullQuoteFor(paragraphs: string[]): string | undefined {
  // Speech often ends in a comma before “she said”; a pull quote drops it, as a sub-editor would.
  const quotes = paragraphs.flatMap(paragraph => [...paragraph.matchAll(/[“"]([^”"]{25,240})[”"]/g)].map(match => match[1].trim().replace(/[,;:]$/, '')));
  const usable = quotes.filter(quote => { const words = quote.split(/\s+/).length; return words >= 6 && words <= 40; });
  return usable.sort((a, b) => Math.abs(a.split(/\s+/).length - 18) - Math.abs(b.split(/\s+/).length - 18))[0];
}

/** News weight: substance first, then a story-specific picture, then freshness. Notices never lead. */
export function newsWeight(article: ComposableArticle, newest: number): number {
  const words = wordCount(article.paragraphs);
  const images = printableImages(article.images);
  const age = article.publishedAt ? Math.max(0, newest - Date.parse(article.publishedAt)) / 86_400_000 : 7;
  let weight = Math.min(words, 650) + (images.some(image => image.relevance === 'subject') ? 160 : images.length ? 70 : 0) - Math.min(age, 14) * 12;
  if (pullQuoteFor(article.paragraphs)) weight += 30;
  if (article.label === 'analysis' || article.label === 'opinion') weight -= 40;
  if (isNotice(article)) weight -= 400;
  return weight;
}

interface Ranked { article: ComposableArticle; words: number; weight: number; images: LicensedImage[]; brief: boolean }

function rank(articles: ComposableArticle[]): Ranked[] {
  const newest = Math.max(0, ...articles.map(article => article.publishedAt ? Date.parse(article.publishedAt) : 0));
  return articles.map(article => {
    const words = wordCount(article.paragraphs);
    return { article, words, weight: newsWeight(article, newest), images: printableImages(article.images), brief: words < BRIEF_WORDS || isNotice(article) };
  }).sort((a, b) => b.weight - a.weight || a.article.publicationId.localeCompare(b.article.publicationId));
}

/** Which story each photograph has been printed with: a photo never illustrates two different stories. */
type PictureLedger = Map<string, string>;
function block(item: Ranked, role: EditionBlock['role'], imagesLeft: { count: number }, ledger: PictureLedger): EditionBlock {
  const id = item.article.publicationId;
  const result: EditionBlock = { publicationId: id, role };
  const free = (image: LicensedImage) => [image.id, image.url].every(key => !ledger.has(key) || ledger.get(key) === id);
  const take = (image: LicensedImage) => { ledger.set(image.id, id); ledger.set(image.url, id); imagesLeft.count -= 1; };
  const index = item.images.findIndex(free);
  if (role !== 'brief' && index >= 0 && imagesLeft.count > 0) {
    result.imageIndex = index; take(item.images[index]);
    const inset = role === 'lead' ? item.images.findIndex((image, other) => other !== index && free(image)) : -1;
    if (inset >= 0 && imagesLeft.count > 0) { result.insetIndex = inset; take(item.images[inset]); }
  }
  if (role === 'lead' || role === 'feature') { const quote = pullQuoteFor(item.article.paragraphs); if (quote) result.pullQuote = quote; }
  return result;
}

/**
 * Page shapes, chosen the way a make-up editor would: a pictured lead gets the picture-led page,
 * two stories of equal weight share a split page, and otherwise the shape rotates so no two
 * neighbouring pages look alike.
 */
function chooseTemplate(majors: Ranked[], previous: EditionPageTemplate | undefined, sequence: number): EditionPageTemplate {
  const lead = majors[0];
  const leadPicture = lead?.images[0];
  const avoid = (template: EditionPageTemplate) => template === previous;
  if (majors.length === 2 && Math.abs(majors[0].words - majors[1].words) < 140 && !avoid('split')) return 'split';
  if (leadPicture && leadPicture.width >= leadPicture.height && lead.words >= 160 && !avoid('picture-led')) return 'picture-led';
  const rotation: EditionPageTemplate[] = majors.length >= 2 ? ['picture-led', 'text-led', 'features'] : ['picture-led', 'text-led'];
  for (let offset = 0; offset < rotation.length; offset++) {
    const template = rotation[(sequence + offset) % rotation.length];
    if (!avoid(template)) return template;
  }
  return 'text-led';
}

const teaserWords = (item: Ranked) => item.article.paragraphs.slice(0, 2).join(' ').split(/\s+/).filter(Boolean).length;

function makePage(ledger: PictureLedger, number: number, section: string, template: EditionPageTemplate, majors: Ranked[], briefs: Ranked[], teasers: Ranked[] = []): EditionPage {
  const imagesLeft = { count: MAX_IMAGES_PER_PAGE };
  const blocks: EditionBlock[] = [];
  majors.forEach((item, index) => blocks.push(block(item, index === 0 ? (template === 'split' ? 'feature' : 'lead') : template === 'split' || template === 'features' ? 'feature' : 'secondary', imagesLeft, ledger)));
  teasers.forEach(item => blocks.push({ ...block(item, 'secondary', imagesLeft, ledger), teaser: true }));
  briefs.forEach(item => blocks.push(block(item, 'brief', imagesLeft, ledger)));
  const words = [...majors, ...briefs].reduce((total, item) => total + item.words, 0) + teasers.reduce((total, item) => total + teaserWords(item), 0);
  const substantial = words >= SUBSTANTIAL_PAGE_WORDS && majors.some(item => item.words >= SUBSTANTIAL_STORY_WORDS);
  return { number, section, template, blocks, words, substantial };
}

/** Arrange articles into pages. Every article appears exactly once; nothing is added. */
export function composeEdition(articles: ComposableArticle[]): EditionPage[] {
    if (!articles.length) return [];
  const ranked = rank(articles);
  const ledger: PictureLedger = new Map();
  const majors = ranked.filter(item => !item.brief);
  const briefs = ranked.filter(item => item.brief);
  const pages: EditionPage[] = [];

  // Front page: one dominant lead (a pictured story if one is strong enough), then up to three
  // secondaries chosen for section variety, then briefs down the rail.
  const lead = majors.find(item => item.images.length && item.weight >= (majors[0]?.weight ?? 0) - 120) ?? majors[0];
  const pool = majors.filter(item => item !== lead);
  const secondaries: Ranked[] = [];
  const sectionsUsed = new Set([lead?.article.section]);
  for (const item of pool) { if (secondaries.length >= 3) break; if (!sectionsUsed.has(item.article.section)) { secondaries.push(item); sectionsUsed.add(item.article.section); } }
  for (const item of pool) { if (secondaries.length >= Math.min(3, Math.max(2, Math.ceil(pool.length / 4)))) break; if (!secondaries.includes(item)) secondaries.push(item); }
  // Secondaries are teased on the front and printed in full inside, as a newspaper jumps a story.
  const frontBriefs = briefs.slice(0, lead ? 3 : MAX_BRIEFS_PER_PAGE * 2);
  const front = makePage(ledger, 1, 'Front Page', 'front', lead ? [lead] : [], frontBriefs, secondaries);
  pages.push(front);

  // Section pages from what remains, strongest section first, split into pages of up to three majors.
  const remaining = majors.filter(item => item !== lead);
  const leftoverBriefs = briefs.filter(item => !frontBriefs.includes(item));
  const bySection = new Map<string, Ranked[]>();
  for (const item of remaining) { const key = item.article.section || 'The Post'; bySection.set(key, [...(bySection.get(key) ?? []), item]); }
  const groups: { section: string; items: Ranked[] }[] = [];
  for (const [section, items] of [...bySection.entries()].sort((a, b) => b[1][0].weight - a[1][0].weight)) {
    for (let index = 0; index < items.length; index += MAX_MAJORS_PER_PAGE) {
      let chunk = items.slice(index, index + MAX_MAJORS_PER_PAGE);
      // Avoid a lonely final story: a page of one short story joins the previous page of its section.
      if (index > 0 && chunk.length === 1 && chunk[0].words < 260 && groups.at(-1)?.section === section && groups.at(-1)!.items.length < MAX_MAJORS_PER_PAGE + 1) { groups.at(-1)!.items.push(...chunk); chunk = []; }
      if (chunk.length) groups.push({ section, items: chunk });
    }
  }
  // Two thin sections share a page rather than leaving two half-empty ones.
  const merged: { section: string; items: Ranked[] }[] = [];
  for (const group of groups) {
    const words = group.items.reduce((total, item) => total + item.words, 0);
    const previous = merged.at(-1);
    const previousWords = previous?.items.reduce((total, item) => total + item.words, 0) ?? 0;
    if (previous && words < SUBSTANTIAL_PAGE_WORDS && previousWords < SUBSTANTIAL_PAGE_WORDS && previous.items.length + group.items.length <= MAX_MAJORS_PER_PAGE + 1) {
      previous.items.push(...group.items);
      if (!previous.section.includes(group.section)) previous.section = `${previous.section} · ${group.section}`;
    } else merged.push({ section: group.section, items: [...group.items] });
  }
  let previous: EditionPageTemplate | undefined = 'front';
  merged.forEach((group, sequence) => {
    const sectionBriefs = leftoverBriefs.filter(item => (item.article.section || 'The Post') === group.section).slice(0, MAX_BRIEFS_PER_PAGE);
    for (const item of sectionBriefs) leftoverBriefs.splice(leftoverBriefs.indexOf(item), 1);
    const template = chooseTemplate(group.items, previous, sequence);
    pages.push(makePage(ledger, pages.length + 1, group.section, template, group.items, sectionBriefs));
    previous = template;
  });
  // Remaining briefs join the lightest pages' rails; any excess becomes an In Brief page.
  while (leftoverBriefs.length) {
    const target = pages.slice(1).filter(page => page.blocks.filter(item => item.role === 'brief').length < MAX_BRIEFS_PER_PAGE).sort((a, b) => a.words - b.words)[0];
    if (!target) break;
    const item = leftoverBriefs.shift()!;
    target.blocks.push({ publicationId: item.article.publicationId, role: 'brief' });
    target.words += item.words;
    target.substantial = target.words >= SUBSTANTIAL_PAGE_WORDS && target.blocks.some(entry => entry.role !== 'brief');
  }
  if (leftoverBriefs.length) {
    const page = makePage(ledger, pages.length + 1, 'In Brief', 'text-led', [], leftoverBriefs.splice(0));
    page.substantial = page.words >= SUBSTANTIAL_PAGE_WORDS;
    pages.push(page);
  }
  // Point each front-page teaser at the page that prints the story in full.
  for (const teaser of pages[0].blocks.filter(item => item.teaser)) {
    const printed = pages.slice(1).find(page => page.blocks.some(item => item.publicationId === teaser.publicationId && !item.teaser));
    const full = printed?.blocks.find(item => item.publicationId === teaser.publicationId && !item.teaser);
    if (printed && full) { teaser.jumpTo = printed.number; full.continuedFrom = 1; }
  }
  return pages;
}

export interface EditionReadiness { pages: number; substantialPages: number; minimum: number; ready: boolean; message: string }

/** Five by default. EDITION_MINIMUM_PAGES can change it; 0 turns the release gate off (used by delivery tests). */
export function minimumPages(): number {
  const raw = process.env.EDITION_MINIMUM_PAGES;
  const configured = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isInteger(configured) && configured >= 0 && configured <= 40 ? configured : MINIMUM_SUBSTANTIAL_PAGES;
}

export function editionReadiness(pages: EditionPage[], minimum = minimumPages()): EditionReadiness {
  const substantialPages = pages.filter(page => page.substantial).length;
  const ready = substantialPages >= minimum;
  const message = ready
    ? `${pages.length} pages composed, ${substantialPages} of them substantial.`
    : `This edition makes ${substantialPages} substantial ${substantialPages === 1 ? 'page' : 'pages'}; the paper needs at least ${minimum}. Add more approved reporting rather than filling space.`;
  return { pages: pages.length, substantialPages, minimum, ready, message };
}
