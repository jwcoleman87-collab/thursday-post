import { errorResponse, requireSameOrigin } from '@/lib/auth';
import { publicMember, requireMember } from '@/lib/members';
import { reconcileMemberSubscription } from '@/lib/commerce';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { requireSameOrigin(request); const member = await requireMember(request); return Response.json({ member: publicMember(await reconcileMemberSubscription(member.id)) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
