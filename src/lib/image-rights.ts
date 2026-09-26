import { z } from 'zod';
import type { LicensedImage } from './domain';

/**
 * Open licences that permit a commercial publication to reprint with credit. NonCommercial and
 * NoDerivatives licences are excluded: the paper is sold, and layouts crop and resize pictures.
 */
const OPEN_LICENCE = /^(cc0|pd|public-domain|cc-by-(\d(\.\d)?)(-[a-z]{2,3})?|cc-by-sa-(\d(\.\d)?)(-[a-z]{2,3})?)$/;
/** Owner-supplied pictures carry James's declaration of the permission he holds. */
const OWNER_LICENCE = /^(owner-own-work|owner-licensed)$/;

export const licensedImageSchema = z.object({
  id: z.string().min(1).max(200),
  url: z.string().url().max(2048).refine(value => value.startsWith('https://'), 'Pictures must be served over https.'),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  alt: z.string().trim().min(3).max(300),
  caption: z.string().trim().min(3).max(600),
  credit: z.string().trim().min(2).max(300),
  licence: z.object({ code: z.string().trim().min(2).max(60), name: z.string().trim().min(2).max(120), url: z.string().url().max(2048).optional() }).strict(),
  origin: z.enum(['wikimedia_commons', 'owner_supplied']),
  sourcePage: z.string().url().max(2048),
  relevance: z.enum(['subject', 'venue', 'file']),
  matchedTerm: z.string().trim().min(1).max(160),
  addedAt: z.string().min(10).max(40),
  addedBy: z.enum(['picture-desk', 'James']),
}).strict();

export function normaliseLicenceCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '-').replace(/^cc-?zero$/, 'cc0');
}

/** A picture may print only when its licence permits reuse and its provenance is complete. */
export function imageRightsCleared(image: LicensedImage): boolean {
  if (!licensedImageSchema.safeParse(image).success) return false;
  const code = normaliseLicenceCode(image.licence.code);
  if (image.origin === 'wikimedia_commons') return OPEN_LICENCE.test(code) && image.sourcePage.startsWith('https://commons.wikimedia.org/') && new URL(image.url).hostname === 'upload.wikimedia.org';
  return OWNER_LICENCE.test(code) && image.addedBy === 'James';
}

export function printableImages(images: LicensedImage[] | undefined): LicensedImage[] {
  return (images ?? []).filter(imageRightsCleared);
}

/** The printed credit line: who made it and under what licence. */
export function creditLine(image: LicensedImage): string {
  const source = image.origin === 'wikimedia_commons' ? ' via Wikimedia Commons' : '';
  const licence = image.licence.code.startsWith('owner-') ? '' : ` · ${image.licence.name}`;
  return `Photo: ${image.credit}${licence}${source}`;
}
