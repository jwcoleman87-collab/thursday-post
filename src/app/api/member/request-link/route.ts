import { errorResponse, requireSameOrigin } from '@/lib/auth';
import { requestMagicLink } from '@/lib/members';
import { readBoundedBody } from '@/lib/email';
import { z } from 'zod';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = z.object({ email: z.string().max(254), deliveryConsent: z.boolean().optional() }).strict().parse(JSON.parse(await readBoundedBody(request, 4096)));
    return Response.json(await requestMagicLink(request, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
