import { errorResponse } from '@/lib/auth';
import { editionPreview, listEditions } from '@/lib/editions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return Response.json({ editions: await Promise.all((await listEditions()).map(editionPreview)) }, { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return errorResponse(error); }
}
