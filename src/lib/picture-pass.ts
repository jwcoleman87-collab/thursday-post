import type { Publication } from './domain';
import { findLicensedImages, mergeImages, picturesPending, type PictureFetch } from './picture-desk';
import { transact } from './store';

/**
 * One bounded pass of the picture desk. Network lookups happen outside the database lock, and
 * every result is saved in a single write, so a pass costs at most one write and no extra reads
 * when the caller already holds the publications. Stories are marked checked even when nothing
 * suitable exists, so the desk never searches (or writes) for the same story twice.
 */
export async function runPictureDesk(publications: Publication[], options: { limit?: number; deadline?: number; fetch?: PictureFetch; force?: boolean } = {}) {
  const targets = options.force ? publications : picturesPending(publications, options.limit ?? 3);
  const results: { id: string; images: Awaited<ReturnType<typeof findLicensedImages>> }[] = [];
  for (const publication of targets) {
    if (options.deadline && Date.now() > options.deadline - 5_000) break;
    const images = await findLicensedImages({ headline: publication.draft.headline, paragraphs: publication.draft.sentences.map(sentence => sentence.text) }, { fetch: options.fetch, deadline: options.deadline });
    results.push({ id: publication.id, images });
  }
  if (!results.length) return { checked: 0, added: 0 };
  const checkedAt = new Date().toISOString();
  return transact(data => {
    let added = 0;
    for (const result of results) {
      const publication = data.state.publications.find(item => item.id === result.id);
      if (!publication) continue;
      const before = publication.images?.length ?? 0;
      publication.images = mergeImages(publication.images, result.images);
      if (!publication.images.length) delete publication.images;
      added += (publication.images?.length ?? 0) - before;
      publication.picturesCheckedAt = checkedAt;
    }
    return { checked: results.length, added };
  });
}
