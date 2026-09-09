import { errorResponse, requireOwner, requireSameOrigin } from '@/lib/auth';
import { getCommerceSettings, updateCommerceSettings } from '@/lib/commerce';
import { readBoundedBody } from '@/lib/email';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { requireOwner(request); return Response.json(await getCommerceSettings(), { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try { requireSameOrigin(request); requireOwner(request); return Response.json(await updateCommerceSettings(JSON.parse(await readBoundedBody(request, 4096))), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return errorResponse(error); }
}
