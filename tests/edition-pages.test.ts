import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ArticleDraft, LicensedImage, Publication, SourceItem, Story } from '../src/lib/domain';
import type { NewspaperEdition } from '../src/lib/edition-types';

const folder = mkdtempSync(join(tmpdir(), 'thursday-edition-pages-test-'));
process.env.NEWSROOM_DB_FILE = join(folder, 'newsroom.sqlite');
process.env.NEWSROOM_DOCUMENT_DB_FILE = join(folder, 'documents.sqlite');
delete process.env.DATABASE_URL; delete process.env.VERCEL; delete process.env.EDITION_MINIMUM_PAGES;
const { closeStore, transact } = await import('../src/lib/store');
const { closeDocuments, updateDocument } = await import('../src/lib/durable-store');
const { createState, draftHash } = await import('../src/lib/engine');
const { createEdition, editionReviewHash, getEdition, releaseEdition } = await import('../src/lib/editions');
after(async () => { await closeStore(); await closeDocuments(); rmSync(folder, { recursive: true, force: true }); });
beforeEach(async () => {
  delete process.env.EDITION_MINIMUM_PAGES;
  await updateDocument('newspaper-editions', () => ({ version: 1, editions: [] as NewspaperEdition[] }), data => { data.editions = []; });
  await transact(data => { data.state = createState(); });
});

const picture: LicensedImage = { id: 'commons-1', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Taree.jpg/1600px-Taree.jpg', width: 1600, height: 1067, alt: 'Taree Racecourse grandstand', caption: 'The grandstand at Taree Racecourse.', credit: 'Anna Rider', licence: { code: 'cc-by-sa-4.0', name: 'CC BY-SA 4.0' }, origin: 'wikimedia_commons', sourcePage: 'https://commons.wikimedia.org/wiki/File:Taree.jpg', relevance: 'venue', matchedTerm: 'Taree', addedAt: '2026-09-20T00:00:00.000Z', addedBy: 'picture-desk' };

async function seed(count: number, words = 240) {
  const stamp = new Date().toISOString();
  const ids: string[] = [];
  await transact(data => {
    for (let index = 0; index < count; index++) {
      const id = `pub-${index}`;
      const source: SourceItem = { id: `source-${index}`, title: 'Racing authority notice', content: 'Notice text.', url: `https://racing.example.org/notice/${index}`, type: 'official', sourceName: 'Racing authority', independenceKey: 'authority', publishedAt: stamp, retrievedAt: stamp };
      const sentences = Array.from({ length: Math.ceil(words / 24) }, (_, n) => ({ text: `Paragraph ${n} of story ${index} records what the stewards found at the Taree meeting and what the trainer said after the race.`, claimIds: [`claim-${index}-${n}`] }));
      const draft: ArticleDraft = { id: `draft-${index}`, headline: `Story ${index} headline`, byline: 'Agent 2', peAgentId: ((index % 4) + 1) as 1 | 2 | 3 | 4, sentences, body: sentences.map(item => item.text).join(' '), hash: '', createdAt: stamp, limitations: [] };
      draft.hash = draftHash(draft);
      const story: Story = { id: `story-${index}`, title: draft.headline, summary: '', mode: 'live', status: 'published', selectedReason: '', researchAgentIds: [2], peAgentId: draft.peAgentId, sourceItems: [source.id], claims: [], findings: [], gaps: [], media: [], draft, compliance: [], approvals: [{ id: `approval-${index}`, decision: 'approve', note: 'Reviewed', actor: 'James', draftHash: draft.hash, wageringAcknowledged: false, createdAt: stamp }], wagering: false, createdAt: stamp, updatedAt: stamp };
      const publication: Publication = { id, storyId: story.id, mode: 'live', public: true, draftHash: draft.hash, draft, approvedBy: 'James', approvedAt: stamp, publishedAt: stamp, ...(index % 3 === 0 ? { images: [{ ...picture, id: `commons-${index}` }] } : {}) };
      data.state.sourceItems.push(source); data.state.stories.push(story); data.state.publications.push(publication); ids.push(id);
    }
  });
  return ids;
}
const input = (ids: string[]) => ({ number: 1, date: '2026-10-01', title: 'The Thursday edition', preview: 'This week in racing.', publicationIds: ids });

test('new editions carry a composed page plan with licensed pictures and presentation fields', async () => {
  const edition = await createEdition(input(await seed(20)));
  assert.ok(edition.pages && edition.pages.length >= 5);
  assert.equal(edition.pages[0].template, 'front');
  const pictured = edition.articles.find(article => article.publicationId === 'pub-0')!;
  assert.equal(pictured.images?.[0].credit, 'Anna Rider');
  assert.ok(pictured.section && pictured.publishedAt);
  assert.equal(edition.reviewHash, editionReviewHash(edition));
});

test('an edition below five substantial pages cannot be released; enough material can', async () => {
  const thin = await createEdition(input(await seed(3)));
  await assert.rejects(releaseEdition(thin.id, thin.reviewHash), /needs at least 5/);
  assert.equal((await getEdition(thin.id)).status, 'draft');
  await updateDocument('newspaper-editions', () => ({ version: 1, editions: [] as NewspaperEdition[] }), data => { data.editions = []; });
  await transact(data => { data.state = createState(); });
  const full = await createEdition(input(await seed(20)));
  const released = await releaseEdition(full.id, full.reviewHash);
  assert.equal(released.status, 'released');
});

test('the review hash survives a database that reorders object keys', async () => {
  const edition = await createEdition(input(await seed(8)));
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const roundTripped = reorder(JSON.parse(JSON.stringify(edition))) as NewspaperEdition;
  assert.equal(editionReviewHash(roundTripped), edition.reviewHash);
});

test('editions made before layout keep their original hash, even after key reordering', () => {
  const articles = [{ publicationId: 'p1', storyId: 's1', draftHash: 'd'.repeat(64), headline: 'Old story', byline: 'Agent 1', paragraphs: ['Text.'], sources: [{ title: 'Source', url: 'https://racing.example.org' }], limitations: [] }];
  const legacy = { id: 'e1', number: 1, date: '2026-09-10', title: 'Old edition', preview: 'Preview', articles };
  const original = JSON.stringify(legacy);
  const expected = createHash('sha256').update(original).digest('hex');
  assert.equal(editionReviewHash(legacy), expected);
  const reordered = { ...legacy, articles: [{ limitations: [], sources: [{ url: 'https://racing.example.org', title: 'Source' }], paragraphs: ['Text.'], byline: 'Agent 1', headline: 'Old story', draftHash: 'd'.repeat(64), storyId: 's1', publicationId: 'p1' }] };
  assert.equal(editionReviewHash(reordered), expected);
});
