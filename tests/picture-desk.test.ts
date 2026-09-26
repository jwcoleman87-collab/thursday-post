import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commonsCandidates, findLicensedImages, pictureTerms } from '../src/lib/picture-desk';
import { creditLine, imageRightsCleared } from '../src/lib/image-rights';
import type { LicensedImage, Publication } from '../src/lib/domain';

const folder = mkdtempSync(join(tmpdir(), 'thursday-pictures-test-'));
process.env.NEWSROOM_DB_FILE = join(folder, 'newsroom.sqlite');
delete process.env.DATABASE_URL; delete process.env.VERCEL;
const { closeStore, readStore, transact } = await import('../src/lib/store');
const { createState } = await import('../src/lib/engine');
const { runPictureDesk } = await import('../src/lib/picture-pass');
after(async () => { await closeStore(); rmSync(folder, { recursive: true, force: true }); });

const story = {
  headline: 'Graham sees a future in a bossy $20,000 gelding',
  paragraphs: ['Trainer Jenny Graham regards Wild Monarch, a lightly raced three-year-old gelding, as a horse of the future, according to Racing NSW.', 'He returned to win a 1000m maiden at Taree, where jockey Daniel Smith moved early. Wild Monarch now heads to Coffs Harbour.'],
};

type Meta = Record<string, { value: string }>;
function page(title: string, meta: Partial<Record<string, string>>, info: Partial<{ mime: string; width: number; height: number }> = {}, index = 1) {
  const extmetadata: Meta = {};
  for (const [key, value] of Object.entries({ License: 'cc-by-sa-4.0', LicenseShortName: 'CC BY-SA 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', Artist: '<a href="//commons.wikimedia.org/wiki/User:Rider">Anna Rider</a>', ...meta })) if (value !== undefined) extmetadata[key] = { value };
  const file = title.replace(/ /g, '_');
  return { title: `File:${title}`, index, imageinfo: [{ url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`, thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/1600px-${file}`, thumbwidth: 1600, thumbheight: 1067, width: info.width ?? 4000, height: info.height ?? 2667, mime: info.mime ?? 'image/jpeg', descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`, extmetadata }] };
}
const response = (pages: unknown[]) => ({ query: { pages } });

test('the desk looks for the story’s own horse, people and racecourse', () => {
  const terms = pictureTerms(story);
  const names = terms.map(term => term.term);
  assert.ok(names.includes('Wild Monarch'), names.join(', '));
  assert.ok(names.includes('Jenny Graham') || names.includes('Daniel Smith'), names.join(', '));
  assert.ok(terms.some(term => term.kind === 'venue' && (term.term === 'Taree' || term.term === 'Coffs Harbour')), names.join(', '));
  assert.ok(!names.includes('Racing NSW'));
  assert.ok(terms.length <= 4);
});

test('only openly licensed, story-specific photographs are accepted, with full provenance', () => {
  const term = { term: 'Wild Monarch', kind: 'subject' as const, weight: 3 };
  const accepted = commonsCandidates(response([
    page('Wild Monarch winning at Taree 2026.jpg', { ImageDescription: 'Racehorse Wild Monarch returns to scale after winning a maiden at Taree', DateTimeOriginal: '2026-08-31' }),
  ]), term, '2026-09-26T00:00:00.000Z');
  assert.equal(accepted.length, 1);
  const [image] = accepted;
  assert.equal(image.origin, 'wikimedia_commons');
  assert.equal(image.relevance, 'subject');
  assert.equal(image.credit, 'Anna Rider');
  assert.equal(image.licence.code, 'cc-by-sa-4.0');
  assert.match(image.caption, /Wild Monarch returns to scale/);
  // Commons upload and scan dates are not reliable capture dates, so no year is added.
  assert.equal(image.caption, 'Racehorse Wild Monarch returns to scale after winning a maiden at Taree.');
  assert.equal(image.sourcePage, 'https://commons.wikimedia.org/wiki/File:Wild_Monarch_winning_at_Taree_2026.jpg');
  assert.ok(imageRightsCleared(image));
  assert.equal(creditLine(image), 'Photo: Anna Rider · CC BY-SA 4.0 via Wikimedia Commons');
});

test('non-commercial, AI-generated, logo, small, unrelated and non-free files are refused', () => {
  const term = { term: 'Wild Monarch', kind: 'subject' as const, weight: 3 };
  const refused = commonsCandidates(response([
    page('Wild Monarch at Taree NC.jpg', { ImageDescription: 'Racehorse Wild Monarch at Taree', License: 'cc-by-nc-4.0', LicenseShortName: 'CC BY-NC 4.0' }),
    page('Wild Monarch racehorse painting.jpg', { ImageDescription: 'Racehorse Wild Monarch', Categories: 'AI-generated images|Horses' }),
    page('Wild Monarch racing logo.jpg', { ImageDescription: 'Racing logo of Wild Monarch' }),
    page('Wild Monarch racehorse small.jpg', { ImageDescription: 'Racehorse Wild Monarch' }, { width: 500 }),
    page('Wild Monarch butterfly.jpg', { ImageDescription: 'A Wild Monarch butterfly on a flower' }),
    page('Wild Monarch racehorse vector.png', { ImageDescription: 'Racehorse Wild Monarch' }, { mime: 'image/png' }),
    page('A generic racehorse.jpg', { ImageDescription: 'A bay racehorse in a paddock' }),
    page('Wild Monarch racehorse unfree.jpg', { ImageDescription: 'Racehorse Wild Monarch', NonFree: 'true' }),
    page('Wild Monarch racehorse anonymous.jpg', { ImageDescription: 'Racehorse Wild Monarch', Artist: '' }),
  ]), term, '2026-09-26T00:00:00.000Z');
  assert.deepEqual(refused, []);
});

test('venue pictures must actually show the racecourse', () => {
  const term = { term: 'Taree', kind: 'venue' as const, weight: 2 };
  const pictures = commonsCandidates(response([
    page('Taree Racecourse grandstand.jpg', { ImageDescription: 'The grandstand at Taree Racecourse, Mid North Coast' }, {}, 1),
    page('Taree main street.jpg', { ImageDescription: 'Victoria Street in Taree' }, {}, 2),
  ]), term, '2026-09-26T00:00:00.000Z');
  assert.equal(pictures.length, 1);
  assert.equal(pictures[0].relevance, 'venue');
});

test('the desk keeps at most two pictures and survives a failed lookup', async () => {
  const calls: string[] = [];
  const images = await findLicensedImages(story, { now: '2026-09-26T00:00:00.000Z', fetch: async url => {
    calls.push(url);
    if (calls.length === 1) throw new Error('network down');
    const term = decodeURIComponent(new URL(url).searchParams.get('gsrsearch')!).match(/"([^"]+)"/)![1];
    return new Response(JSON.stringify(response([page(`${term} racecourse horse race ${calls.length}.jpg`, { ImageDescription: `${term} racing, horse race meeting` })])));
  } });
  assert.ok(calls.length >= 2);
  assert.ok(images.length <= 2 && images.length >= 1);
  for (const url of calls) assert.ok(url.startsWith('https://commons.wikimedia.org/w/api.php?'));
});

test('owner pictures need James’s own permission; Commons pictures need a Commons provenance page', () => {
  const base: LicensedImage = { id: 'owner-1', url: 'https://images.example.org/photo.jpg', width: 1600, height: 1000, alt: 'Trainer at the stables', caption: 'Jenny Graham at her Grafton stables.', credit: 'James Coleman', licence: { code: 'owner-own-work', name: 'Photographed by the editor' }, origin: 'owner_supplied', sourcePage: 'https://images.example.org/photo', relevance: 'subject', matchedTerm: 'Jenny Graham', addedAt: '2026-09-26T00:00:00.000Z', addedBy: 'James' };
  assert.ok(imageRightsCleared(base));
  assert.ok(!imageRightsCleared({ ...base, addedBy: 'picture-desk' }));
  assert.ok(!imageRightsCleared({ ...base, licence: { code: 'unknown', name: 'Unknown' } }));
  assert.ok(!imageRightsCleared({ ...base, origin: 'wikimedia_commons', licence: { code: 'cc-by-4.0', name: 'CC BY 4.0' } }));
  assert.ok(!imageRightsCleared({ ...base, url: 'http://images.example.org/photo.jpg' }));
  const commons = { ...base, id: 'c', origin: 'wikimedia_commons' as const, licence: { code: 'cc-by-4.0', name: 'CC BY 4.0' }, sourcePage: 'https://commons.wikimedia.org/wiki/File:X.jpg', addedBy: 'picture-desk' as const, url: 'https://upload.wikimedia.org/wikipedia/commons/x.jpg' };
  assert.ok(imageRightsCleared(commons));
  assert.ok(!imageRightsCleared({ ...commons, url: 'https://elsewhere.example.org/x.jpg' }));
});

test('a picture pass writes once, marks stories checked, and never searches the same story twice', async () => {
  const stamp = '2026-09-20T00:00:00.000Z';
  const publication = { id: 'pub-pictures', storyId: 'story-pictures', mode: 'live', public: true, draftHash: 'a'.repeat(64), draft: { id: 'draft', headline: story.headline, byline: 'Agent 2', peAgentId: 2, sentences: story.paragraphs.map(text => ({ text, claimIds: [] })), body: '', hash: 'a'.repeat(64), createdAt: stamp, limitations: [] }, approvedBy: 'James', approvedAt: stamp, publishedAt: stamp } as Publication;
  await transact(data => { data.state = createState(); data.state.publications.push(publication); });
  const before = (await readStore()).revision;
  let lookups = 0;
  const fetch = async (url: string) => { lookups++; const term = new URL(url).searchParams.get('gsrsearch')!.match(/"([^"]+)"/)![1]; return new Response(JSON.stringify(response([page(`${term} racehorse at the races.jpg`, { ImageDescription: `${term} at the races, racecourse meeting` })]))); };
  const first = await runPictureDesk((await readStore()).state.publications, { fetch });
  assert.equal(first.checked, 1);
  assert.ok(first.added >= 1);
  const stored = (await readStore());
  assert.equal(stored.revision, before + 1);
  assert.ok(stored.state.publications[0].picturesCheckedAt);
  assert.ok(stored.state.publications[0].images!.every(imageRightsCleared));
  assert.equal(stored.state.publications[0].draftHash, 'a'.repeat(64));
  const lookupsAfterFirst = lookups;
  const second = await runPictureDesk(stored.state.publications, { fetch });
  assert.deepEqual(second, { checked: 0, added: 0 });
  assert.equal(lookups, lookupsAfterFirst);
  assert.equal((await readStore()).revision, before + 1);
});

test('found on the live preview: stations, statues and catalogue records are not venue pictures or captions', () => {
  const flemington = { term: 'Flemington', kind: 'venue' as const, weight: 2 };
  const rejected = commonsCandidates(response([
    page('Train at Flemington Racecourse railway station, Melbourne.jpg', { ImageDescription: 'w:Comeng (train) at w:Flemington Racecourse railway station, Melbourne.' }),
    page('Makybe Diva statue at Flemington Racecourse.jpg', { ImageDescription: 'Statue of Makybe Diva at Flemington Racecourse' }),
  ]), flemington, '2026-09-26T00:00:00.000Z');
  assert.deepEqual(rejected, []);
  const rosehill = commonsCandidates(response([
    page('Rosehill Racecourse, N.S.W., Saddling Paddock.jpg', { ImageDescription: 'Format: Glass plate negative. Rights Info: No known restrictions on publication. Repository: Tyrrell Collection' }),
  ]), { term: 'Rosehill', kind: 'venue', weight: 2 }, '2026-09-26T00:00:00.000Z');
  assert.equal(rosehill.length, 1);
  assert.match(rosehill[0].caption, /^Rosehill Racecourse, N\.S\.W\., Saddling Paddock/);
  assert.doesNotMatch(rosehill[0].caption, /Format:|Repository/);
});

test('a statue of the story’s own horse is a fair subject picture, and plural racing words count', () => {
  const statue = commonsCandidates(response([page('Makybe Diva statue.jpg', { ImageDescription: 'Statue of Makybe Diva at Flemington Racecourse' })]), { term: 'Makybe Diva', kind: 'subject', weight: 3 }, '2026-09-26T00:00:00.000Z');
  assert.equal(statue.length, 1);
  const pharLap = commonsCandidates(response([page('Phar Lap with his strapper.jpg', { ImageDescription: 'Phar Lap with his strapper Tommy Woodcock', Categories: 'Phar Lap|Racehorses from New Zealand' })]), { term: 'Phar Lap', kind: 'subject', weight: 3 }, '2026-09-26T00:00:00.000Z');
  assert.equal(pharLap.length, 1);
});
