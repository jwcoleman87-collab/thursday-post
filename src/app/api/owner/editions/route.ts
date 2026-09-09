import { errorResponse, requireOwner, requireSameOrigin } from '@/lib/auth';
import { createEdition, eligiblePublication, listEditions } from '@/lib/editions';
import { getDeliveryStatus } from '@/lib/delivery';
import { readStore } from '@/lib/store';
import { readBoundedBody } from '@/lib/email';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    requireOwner(request);
    const { state } = await readStore();
    return Response.json({ editions: await listEditions({ includeDrafts: true }), delivery: await getDeliveryStatus(), publications: state.publications.filter(publication => eligiblePublication(publication, state)).map(publication => ({ id: publication.id, headline: publication.draft.headline, byline: publication.draft.byline, publishedAt: publication.publishedAt })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    requireOwner(request); requireSameOrigin(request);
    const edition = await createEdition(JSON.parse(await readBoundedBody(request, 20_000)));
    return Response.json({ edition }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
