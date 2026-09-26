import { createHash } from 'node:crypto';
import { z } from 'zod';
import { errorResponse, HttpError, requireOwner, requireSameOrigin } from '@/lib/auth';
import { readBoundedBody } from '@/lib/email';
import { imageRightsCleared } from '@/lib/image-rights';
import { runPictureDesk } from '@/lib/picture-pass';
import { readStore, transact } from '@/lib/store';
import type { LicensedImage } from '@/lib/domain';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ownerImage = z.object({
  url: z.string().url().max(2048), width: z.number().int().min(200).max(20000), height: z.number().int().min(200).max(20000),
  alt: z.string().trim().min(3).max(300), caption: z.string().trim().min(3).max(600), credit: z.string().trim().min(2).max(300),
  /** James's declaration: his own photograph, or one he holds a licence to publish. */
  permission: z.enum(['owner-own-work', 'owner-licensed']), permissionNote: z.string().trim().min(3).max(120),
  sourcePage: z.string().url().max(2048), relevance: z.enum(['subject', 'venue', 'file']), matchedTerm: z.string().trim().min(1).max(160),
}).strict();
const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('find'), publicationId: z.string().min(1).max(150) }).strict(),
  z.object({ action: z.literal('add'), publicationId: z.string().min(1).max(150), image: ownerImage }).strict(),
  z.object({ action: z.literal('remove'), publicationId: z.string().min(1).max(150), imageId: z.string().min(1).max(200) }).strict(),
]);

export async function POST(request: Request) {
  try {
    requireOwner(request); requireSameOrigin(request);
    const input = body.parse(JSON.parse(await readBoundedBody(request, 12_000)));
    if (input.action === 'find') {
      const publication = (await readStore()).state.publications.find(item => item.id === input.publicationId);
      if (!publication) throw new HttpError('Story not found.', 404);
      const result = await runPictureDesk([publication], { force: true, deadline: Date.now() + 45_000 });
      return Response.json({ ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const images = await transact(data => {
      const publication = data.state.publications.find(item => item.id === input.publicationId);
      if (!publication) throw new HttpError('Story not found.', 404);
      if (input.action === 'remove') {
        publication.images = (publication.images ?? []).filter(image => image.id !== input.imageId);
        if (!publication.images.length) delete publication.images;
        return publication.images ?? [];
      }
      const { permission, permissionNote, ...fields } = input.image;
      const image: LicensedImage = { ...fields, id: `owner-${createHash('sha256').update(fields.url).digest('hex').slice(0, 20)}`, licence: { code: permission, name: permissionNote }, origin: 'owner_supplied', addedAt: new Date().toISOString(), addedBy: 'James' };
      if (!imageRightsCleared(image)) throw new HttpError('That picture is missing required provenance.', 422);
      publication.images = [image, ...(publication.images ?? []).filter(item => item.id !== image.id)].slice(0, 4);
      return publication.images;
    });
    return Response.json({ images }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
