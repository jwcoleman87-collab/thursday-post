import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './auth';
import { readDocument, updateDocument } from './durable-store';
import { readStore } from './store';
import { draftHash } from './engine';
import type { NewsroomState, Publication } from './domain';
import type { EditionArticle, NewspaperEdition } from './edition-types';
import { sectionFor } from './dashboard';
import { composeEdition, editionReadiness } from './edition-layout';
import { printableImages } from './image-rights';
import { canonicalJson } from './integrity-json';

const key = 'newspaper-editions';
const initial = () => ({ version: 1 as const, editions: [] as NewspaperEdition[] });
const inputSchema = z.object({
  number: z.number().int().min(1).max(99999),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().startsWith(value), 'Enter a valid edition date.'),
  title: z.string().trim().min(1).max(180),
  preview: z.string().trim().min(1).max(1500),
  publicationIds: z.array(z.string().min(1).max(150)).min(1).max(40).refine(ids => new Set(ids).size === ids.length, 'An article can appear only once.'),
});
export type EditionInput = z.infer<typeof inputSchema>;

export function eligiblePublication(publication: Publication, state: NewsroomState): boolean {
  if (publication.mode !== 'live' || !publication.public || publication.status === 'retracted' || publication.status === 'removed' || publication.approvedBy !== 'James') return false;
  if (!publication.approvedAt || publication.draftHash !== publication.draft.hash || draftHash(publication.draft) !== publication.draftHash) return false;
  const story = state.stories.find(item => item.id === publication.storyId);
  if (!story || story.mode !== 'live' || !story.approvals.some(approval => approval.actor === 'James' && approval.decision === 'approve' && approval.draftHash === publication.draftHash && approval.createdAt === publication.approvedAt)) return false;
  if (!story.sourceItems.length || story.sourceItems.some(id => !state.sourceItems.find(source => source.id === id && !source.demo && !source.url.includes('example.invalid')))) return false;
  return true;
}

type HashableEdition = Pick<NewspaperEdition, 'id' | 'number' | 'date' | 'title' | 'preview' | 'articles'> & { pages?: NewspaperEdition['pages'] };

/** The key order the edition writer used before layout existed, rebuilt so a jsonb round trip cannot change the hash. */
function legacyArticle(article: EditionArticle) {
  return { publicationId: article.publicationId, storyId: article.storyId, draftHash: article.draftHash, headline: article.headline, byline: article.byline, paragraphs: article.paragraphs, sources: article.sources.map(source => ({ title: source.title, url: source.url })), limitations: article.limitations };
}

/**
 * Editions with a page plan hash canonical JSON (key order independent, as PostgreSQL jsonb reorders
 * keys). Editions made before layout keep their original hash by rebuilding the writer's key order.
 */
export function editionReviewHash(edition: HashableEdition) {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  if (edition.pages) return hash(canonicalJson({ id: edition.id, number: edition.number, date: edition.date, title: edition.title, preview: edition.preview, articles: edition.articles, pages: edition.pages }));
  return hash(JSON.stringify({ id: edition.id, number: edition.number, date: edition.date, title: edition.title, preview: edition.preview, articles: edition.articles.map(legacyArticle) }));
}

function snapshots(ids: string[], state: NewsroomState): EditionArticle[] {
  return ids.map(id => {
    const publication = state.publications.find(item => item.id === id);
    if (!publication || !eligiblePublication(publication, state)) throw new HttpError('Every edition article must be an approved, current live publication.', 409);
    const story = state.stories.find(item => item.id === publication.storyId)!;
    return {
      publicationId: publication.id, storyId: publication.storyId, draftHash: publication.draftHash,
      headline: publication.draft.headline, byline: publication.draft.byline,
      paragraphs: publication.draft.sentences.map(sentence => sentence.text),
      sources: state.sourceItems.filter(source => story.sourceItems.includes(source.id) && /^https?:\/\//i.test(source.url) && source.type !== 'email').map(source => ({ title: source.title, url: source.url })),
      limitations: [...publication.draft.limitations],
      section: sectionFor(publication.draft.peAgentId),
      ...(publication.draft.deck ? { deck: publication.draft.deck } : {}),
      ...(publication.draft.label ? { label: publication.draft.label } : {}),
      publishedAt: publication.publishedAt,
      ...(printableImages(publication.images).length ? { images: printableImages(publication.images) } : {}),
    };
  });
}

/** The page plan for a set of snapshotted articles. */
export function editionPages(articles: EditionArticle[]) {
  return composeEdition(articles.map(article => ({ publicationId: article.publicationId, headline: article.headline, paragraphs: article.paragraphs, section: article.section, deck: article.deck, label: article.label, publishedAt: article.publishedAt, images: article.images })));
}

export async function listEditions(options: { includeDrafts?: boolean } = {}) {
  const data = await readDocument(key, initial);
  return data.editions.filter(edition => options.includeDrafts || edition.status === 'released').sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
}

export async function getEdition(id: string) {
  const edition = (await readDocument(key, initial)).editions.find(item => item.id === id);
  if (!edition) throw new HttpError('Edition not found.', 404);
  return edition;
}

export async function createEdition(input: unknown) {
  const parsed = inputSchema.parse(input);
  const articles = snapshots(parsed.publicationIds, (await readStore()).state);
  return updateDocument(key, initial, data => {
    if (data.editions.some(edition => edition.number === parsed.number)) throw new HttpError('That edition number already exists.', 409);
    const now = new Date().toISOString();
    const edition: NewspaperEdition = { id: randomUUID(), number: parsed.number, date: parsed.date, title: parsed.title, preview: parsed.preview, articles, pages: editionPages(articles), status: 'draft', createdAt: now, updatedAt: now, reviewHash: '' };
    edition.reviewHash = editionReviewHash(edition);
    data.editions.push(edition);
    return edition;
  });
}

export async function updateEdition(id: string, input: unknown, expectedReviewHash: string) {
  const parsed = inputSchema.parse(input);
  const articles = snapshots(parsed.publicationIds, (await readStore()).state);
  return updateDocument(key, initial, data => {
    const edition = data.editions.find(item => item.id === id);
    if (!edition) throw new HttpError('Edition not found.', 404);
    if (edition.status !== 'draft') throw new HttpError('Released editions cannot be edited. Create a new edition for corrections.', 409);
    if (edition.reviewHash !== expectedReviewHash) throw new HttpError('The edition changed. Review it again.', 409);
    if (data.editions.some(item => item.id !== id && item.number === parsed.number)) throw new HttpError('That edition number already exists.', 409);
    Object.assign(edition, { number: parsed.number, date: parsed.date, title: parsed.title, preview: parsed.preview, articles, pages: editionPages(articles), updatedAt: new Date().toISOString() });
    edition.reviewHash = editionReviewHash(edition);
    return edition;
  });
}

/** Revalidate the source publications whenever an archived edition is read or sent. */
export async function currentEditionArticles(edition: NewspaperEdition) {
  const { state } = await readStore();
  return edition.articles.filter(article => {
    const publication = state.publications.find(item => item.id === article.publicationId);
    return publication && publication.draftHash === article.draftHash && eligiblePublication(publication, state);
  });
}

export async function releaseEdition(id: string, expectedReviewHash: string) {
  const candidate = await getEdition(id);
  if ((await currentEditionArticles(candidate)).length !== candidate.articles.length) throw new HttpError('An article has been withdrawn or changed. Update and review the edition.', 409);
  if (candidate.status !== 'released') {
    const readiness = editionReadiness(candidate.pages ?? editionPages(candidate.articles));
    if (!readiness.ready) throw new HttpError(readiness.message, 409);
  }
  return updateDocument(key, initial, data => {
    const edition = data.editions.find(item => item.id === id)!;
    if (!expectedReviewHash || edition.reviewHash !== expectedReviewHash || editionReviewHash(edition) !== expectedReviewHash) throw new HttpError('The edition changed. Review it again before release.', 409);
    if (edition.status === 'released') return edition;
    edition.status = 'released'; edition.releasedBy = 'James'; edition.releasedAt = new Date().toISOString(); edition.updatedAt = edition.releasedAt;
    return edition;
  });
}

/** This projection cannot contain a paid article body. */
export async function editionPreview(edition: NewspaperEdition) {
  const articles = await currentEditionArticles(edition);
  const intact = articles.length === edition.articles.length;
  const pages = edition.pages ?? editionPages(edition.articles);
  return { id: edition.id, number: edition.number, date: edition.date, title: edition.title, preview: intact ? edition.preview : 'An article in this edition has been withdrawn. The remaining reporting is available below.', releasedAt: edition.releasedAt, articleCount: articles.length, articles: articles.map(article => ({ publicationId: article.publicationId, headline: article.headline, byline: article.byline, ...(article.section ? { section: article.section } : {}) })), withdrawnCount: edition.articles.length - articles.length, pageCount: pages.length, pages: pages.map(page => ({ number: page.number, section: page.section })) };
}
