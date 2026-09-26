import test from 'node:test';
import assert from 'node:assert/strict';
import { composeEdition, editionReadiness, pullQuoteFor, type ComposableArticle } from '../src/lib/edition-layout';
import type { LicensedImage } from '../src/lib/domain';

const SECTIONS = ['Integrity & Governance', 'People & Stables', 'Business & Bloodstock', 'International'];
const sentence = (seed: number) => `The steward's report from meeting ${seed} recorded that the gelding travelled wide and finished the race strongly under a patient ride.`;
function paragraphs(words: number, seed: number, quote = false): string[] {
  const result: string[] = [];
  let count = 0;
  while (count < words) { const text = sentence(seed + result.length); result.push(text); count += text.split(/\s+/).length; }
  if (quote) result.splice(1, 0, '“He is a very headstrong horse and he is bossy, but otherwise he is going well,” the trainer said after the trial.');
  return result;
}
function picture(id: string, relevance: LicensedImage['relevance'] = 'subject'): LicensedImage {
  return { id, url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1600px-${id}.jpg`, width: 1600, height: 1067, alt: 'A horse in the mounting yard', caption: 'A horse in the mounting yard at Randwick', credit: 'Jane Photographer', licence: { code: 'cc-by-sa-4.0', name: 'CC BY-SA 4.0' }, origin: 'wikimedia_commons', sourcePage: `https://commons.wikimedia.org/wiki/File:${id}.jpg`, relevance, matchedTerm: 'Randwick', addedAt: '2026-09-20T00:00:00.000Z', addedBy: 'picture-desk' };
}
function article(index: number, words: number, extra: Partial<ComposableArticle> = {}): ComposableArticle {
  return { publicationId: `pub-${String(index).padStart(2, '0')}`, headline: `Story ${index}`, paragraphs: paragraphs(words, index * 10, index % 3 === 0), section: SECTIONS[index % 4], publishedAt: new Date(Date.UTC(2026, 8, 20, 12) - index * 3_600_000).toISOString(), ...extra };
}
const everyId = (pages: ReturnType<typeof composeEdition>) => pages.flatMap(page => page.blocks.filter(block => !block.teaser).map(block => block.publicationId));

test('every approved article is printed in full exactly once and nothing is added to fill space', () => {
  const articles = Array.from({ length: 23 }, (_, index) => article(index, index % 5 === 0 ? 60 : 180 + (index % 4) * 70, index % 4 === 1 ? { images: [picture(`p${index}`)] } : {}));
  const pages = composeEdition(articles);
  const ids = everyId(pages);
  assert.equal(ids.length, articles.length);
  assert.deepEqual([...ids].sort(), articles.map(item => item.publicationId).sort());
});

test('front-page teasers jump to the page that prints the story in full', () => {
  const pages = composeEdition(Array.from({ length: 12 }, (_, index) => article(index, 240)));
  const teasers = pages[0].blocks.filter(block => block.teaser);
  assert.ok(teasers.length >= 2);
  assert.ok(pages.slice(1).every(page => page.blocks.every(block => !block.teaser)));
  for (const teaser of teasers) {
    const target = pages.find(page => page.number === teaser.jumpTo)!;
    const full = target.blocks.find(block => block.publicationId === teaser.publicationId && !block.teaser)!;
    assert.equal(full.continuedFrom, 1);
  }
});

test('strong material makes at least five substantial pages, and more when there is more', () => {
  const articles = Array.from({ length: 22 }, (_, index) => article(index, 200 + (index % 5) * 60, index % 3 === 0 ? { images: [picture(`p${index}`)] } : {}));
  const pages = composeEdition(articles);
  const readiness = editionReadiness(pages, 5);
  assert.ok(readiness.ready, readiness.message);
  assert.ok(pages.length >= 6, `expected more than five pages, got ${pages.length}`);
  const bigger = composeEdition(Array.from({ length: 34 }, (_, index) => article(index, 220 + (index % 5) * 60)));
  assert.ok(bigger.length > pages.length);
});

test('thin material is not padded: fewer pages and a clear release message', () => {
  const pages = composeEdition([article(1, 240), article(2, 190)]);
  assert.ok(pages.length <= 2);
  assert.equal(everyId(pages).length, 2);
  const readiness = editionReadiness(pages, 5);
  assert.equal(readiness.ready, false);
  assert.match(readiness.message, /at least 5/);
});

test('the front page has one dominant lead, and a strong pictured story takes it', () => {
  const articles = [article(1, 420), article(2, 380, { images: [picture('lead')] }), article(3, 250), article(4, 210), article(5, 70)];
  const [front] = composeEdition(articles);
  assert.equal(front.template, 'front');
  const leads = front.blocks.filter(block => block.role === 'lead');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].publicationId, 'pub-02');
  assert.equal(leads[0].imageIndex, 0);
  assert.ok(front.blocks.some(block => block.role === 'secondary'));
});

test('corrections and updates never lead a page', () => {
  const pages = composeEdition([article(1, 500, { label: 'correction' }), article(2, 200), article(3, 180)]);
  assert.notEqual(pages[0].blocks.find(block => block.role === 'lead')?.publicationId, 'pub-01');
});

test('pages carry at most four pictures and briefs never take one', () => {
  const articles = Array.from({ length: 16 }, (_, index) => article(index, index % 4 === 0 ? 70 : 260, { images: [picture(`a${index}`), picture(`b${index}`)] }));
  for (const page of composeEdition(articles)) {
    const used = page.blocks.reduce((total, block) => total + (block.imageIndex === undefined ? 0 : 1) + (block.insetIndex === undefined ? 0 : 1), 0);
    assert.ok(used <= 4, `page ${page.number} uses ${used} pictures`);
    assert.ok(page.blocks.filter(block => block.role === 'brief').every(block => block.imageIndex === undefined));
  }
});

test('pictures without a cleared licence are ignored by the make-up desk', () => {
  const unlicensed = { ...picture('nc'), licence: { code: 'cc-by-nc-4.0', name: 'CC BY-NC 4.0' } };
  const [front] = composeEdition([article(1, 300, { images: [unlicensed] }), article(2, 250)]);
  assert.ok(front.blocks.every(block => block.imageIndex === undefined));
});

test('pull quotes are verbatim quotations from the approved text', () => {
  const text = ['The trainer spoke after the gallop.', '“He is a very headstrong horse and he is bossy, but otherwise he is going well,” she said.'];
  assert.equal(pullQuoteFor(text), 'He is a very headstrong horse and he is bossy, but otherwise he is going well');
  assert.equal(pullQuoteFor(['No quotation here at all.']), undefined);
  const pages = composeEdition(Array.from({ length: 12 }, (_, index) => article(index, 260)));
  for (const block of pages.flatMap(page => page.blocks)) if (block.pullQuote) {
    const source = Array.from({ length: 12 }, (_, index) => article(index, 260)).find(item => item.publicationId === block.publicationId)!;
    assert.ok(source.paragraphs.join(' ').includes(block.pullQuote));
    assert.doesNotMatch(block.pullQuote, /[,;:]$/);
  }
});

test('section pages vary their templates rather than repeating one', () => {
  const articles = Array.from({ length: 24 }, (_, index) => article(index, 240 + (index % 3) * 80, index % 2 ? { images: [picture(`v${index}`)] } : {}));
  const templates = composeEdition(articles).slice(1).map(page => page.template);
  for (let index = 1; index < templates.length; index++) assert.ok(!(templates[index] === templates[index - 1] && templates[index] === 'picture-led'), templates.join(','));
  assert.ok(new Set(templates).size >= 2, templates.join(','));
});

test('the same photograph never illustrates two different stories', () => {
  const shared = picture('flemington-shared', 'venue');
  const articles = Array.from({ length: 10 }, (_, index) => article(index, 260, { images: [shared] }));
  const pages = composeEdition(articles);
  const users = new Set(pages.flatMap(page => page.blocks).filter(block => block.imageIndex !== undefined).map(block => block.publicationId));
  assert.equal(users.size, 1);
});

test('a teased story keeps its own photograph when printed in full inside', () => {
  const articles = Array.from({ length: 8 }, (_, index) => article(index, 260, { images: [picture(`own-${index}`)] }));
  const pages = composeEdition(articles);
  for (const teaser of pages[0].blocks.filter(block => block.teaser && block.imageIndex !== undefined)) {
    const full = pages.flatMap(page => page.blocks).find(block => block.publicationId === teaser.publicationId && !block.teaser)!;
    assert.equal(full.imageIndex, teaser.imageIndex);
  }
});
