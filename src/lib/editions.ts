import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './auth';
import { readDocument, updateDocument } from './durable-store';
import { readStore } from './store';
import { draftHash } from './engine';
import type { NewsroomState, Publication } from './domain';
import type { EditionArticle, NewspaperEdition } from './edition-types';

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

export function editionReviewHash(edition: Pick<NewspaperEdition, 'id' | 'number' | 'date' | 'title' | 'preview' | 'articles'>) {
  return createHash('sha256').update(JSON.stringify({ id: edition.id, number: edition.number, date: edition.date, title: edition.title, preview: edition.preview, articles: edition.articles })).digest('hex');
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
    };
  });
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
    const edition: NewspaperEdition = { id: randomUUID(), number: parsed.number, date: parsed.date, title: parsed.title, preview: parsed.preview, articles, status: 'draft', createdAt: now, updatedAt: now, reviewHash: '' };
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
    Object.assign(edition, { number: parsed.number, date: parsed.date, title: parsed.title, preview: parsed.preview, articles, updatedAt: new Date().toISOString() });
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
  return { id: edition.id, number: edition.number, date: edition.date, title: edition.title, preview: intact ? edition.preview : 'An article in this edition has been withdrawn. The remaining reporting is available below.', releasedAt: edition.releasedAt, articleCount: articles.length, articles: articles.map(article => ({ publicationId: article.publicationId, headline: article.headline, byline: article.byline })), withdrawnCount: edition.articles.length - articles.length };
}
