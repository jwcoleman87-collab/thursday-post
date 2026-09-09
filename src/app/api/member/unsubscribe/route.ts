import { errorResponse, requireSameOrigin } from '@/lib/auth';
import { unsubscribeMember } from '@/lib/members';
import { readBoundedBody } from '@/lib/email';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = z.object({ token: z.string().max(2000) }).strict().parse(JSON.parse(await readBoundedBody(request, 4096)));
    await unsubscribeMember(body.token);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
