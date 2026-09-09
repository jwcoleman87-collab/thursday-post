import { errorResponse, requireSameOrigin } from '@/lib/auth';
import { requireMember } from '@/lib/members';
import { createMemberCheckout } from '@/lib/commerce';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { requireSameOrigin(request); const member = await requireMember(request); return Response.json(await createMemberCheckout(member.id), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
