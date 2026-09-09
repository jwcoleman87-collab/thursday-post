import { errorResponse, HttpError } from '@/lib/auth';
import { currentEditionArticles, editionPreview, getEdition } from '@/lib/editions';
import { currentMember, hasPaidAccess } from '@/lib/members';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const edition = await getEdition((await params).id);
    if (edition.status !== 'released') throw new HttpError('Edition not found.', 404);
    const member = await currentMember(request);
    const entitled = Boolean(member && hasPaidAccess(member));
    const preview = await editionPreview(edition);
    return Response.json({ edition: { ...preview, ...(entitled ? { articles: await currentEditionArticles(edition) } : {}) }, entitled }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  } catch (error) { return errorResponse(error); }
}
