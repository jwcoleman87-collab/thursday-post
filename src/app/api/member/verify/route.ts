import { errorResponse, requireSameOrigin } from '@/lib/auth';
import { consumeMagicLink, memberCookie } from '@/lib/members';
import { readBoundedBody } from '@/lib/email';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = z.object({ token: z.string().max(100) }).strict().parse(JSON.parse(await readBoundedBody(request, 4096)));
    const token = await consumeMagicLink(body.token);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': memberCookie(token, request) } });
  } catch (error) { return errorResponse(error); }
}
