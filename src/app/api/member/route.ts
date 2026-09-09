import { errorResponse, requireSameOrigin } from '@/lib/auth';
import { currentMember, memberCookie, publicMember, requireMember, signOutMember, updateMemberPreferences } from '@/lib/members';
import { getCommerceReadiness } from '@/lib/commerce';
import { readBoundedBody } from '@/lib/email';
import { z } from 'zod';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export async function GET(request: Request) {
  try {
    const member = await currentMember(request);
    const readiness = await getCommerceReadiness();
    return Response.json({ member: member ? publicMember(member) : null, sales: { salesOpen: readiness.salesOpen, signInReady: readiness.memberSignInReady, monthlyAmount: readiness.monthlyAmount, currency: readiness.currency, mode: readiness.mode } }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    const member = await requireMember(request);
    const body = z.object({ deliveryEnabled: z.boolean() }).strict().parse(JSON.parse(await readBoundedBody(request, 4096)));
    return Response.json({ member: await updateMemberPreferences(member.id, body.deliveryEnabled) }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try { requireSameOrigin(request); await signOutMember(request); return Response.json({ ok: true }, { headers: { ...headers, 'Set-Cookie': memberCookie('', request) } }); }
  catch (error) { return errorResponse(error); }
}
