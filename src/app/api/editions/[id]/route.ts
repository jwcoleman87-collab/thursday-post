import { errorResponse, HttpError, requireOwner } from '@/lib/auth';
import { currentEditionArticles, editionPages, editionPreview, getEdition } from '@/lib/editions';
import { editionReadiness } from '@/lib/edition-layout';
import { currentMember, hasPaidAccess } from '@/lib/members';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function ownerPreview(request: Request) {
  try { requireOwner(request); return true; } catch { return false; }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const edition = await getEdition((await params).id);
    // Drafts are visible only to the owner, so James can review the composed pages before release.
    const owner = ownerPreview(request);
    if (edition.status !== 'released' && !owner) throw new HttpError('Edition not found.', 404);
    const member = await currentMember(request);
    const entitled = owner || Boolean(member && hasPaidAccess(member));
    const preview = await editionPreview(edition);
    const pages = edition.pages ?? editionPages(edition.articles);
    // The page plan carries pull quotes from paid text, so only entitled readers receive it.
    const full = entitled ? { articles: await currentEditionArticles(edition), layout: pages, ...(owner ? { readiness: editionReadiness(pages), status: edition.status } : {}) } : {};
    return Response.json({ edition: { ...preview, ...full }, entitled }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
  } catch (error) { return errorResponse(error); }
}
