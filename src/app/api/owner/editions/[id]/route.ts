import { z } from 'zod';
import { errorResponse, HttpError, requireOwner, requireSameOrigin } from '@/lib/auth';
import { getEdition, releaseEdition, updateEdition } from '@/lib/editions';
import { getDeliveryStatus, processDeliveryQueue, queueEditionDelivery } from '@/lib/delivery';
import { readBoundedBody } from '@/lib/email';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try { requireOwner(request); const { id } = await params; return Response.json({ edition: await getEdition(id), delivery: await getDeliveryStatus(id) }, { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    requireOwner(request); requireSameOrigin(request);
    const input = JSON.parse(await readBoundedBody(request, 20_000));
    const { expectedReviewHash } = z.object({ expectedReviewHash: z.string().min(1).max(100) }).parse(input);
    return Response.json({ edition: await updateEdition((await params).id, input, expectedReviewHash) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    requireOwner(request); requireSameOrigin(request);
    const { action, expectedReviewHash } = z.object({ action: z.enum(['release', 'send', 'process']), expectedReviewHash: z.string().min(1).max(100) }).parse(JSON.parse(await readBoundedBody(request, 2000)));
    const { id } = await params;
    if (action === 'release') return Response.json({ edition: await releaseEdition(id, expectedReviewHash) });
    if (action === 'send') return Response.json(await queueEditionDelivery(id, expectedReviewHash));
    // Processing never creates a campaign; only an earlier explicit SEND can create jobs.
    const edition = await getEdition(id);
    if (edition.reviewHash !== expectedReviewHash) throw new HttpError('The edition changed. Review it again.', 409);
    return Response.json(await processDeliveryQueue({ limit: 5, editionId: id }));
  } catch (error) { return errorResponse(error); }
}
