import { z } from 'zod';
import { errorResponse, requireOwner, requireSameOrigin, HttpError } from '@/lib/auth';
import { readBoundedBody } from '@/lib/email';
import { finishRunRecord, operationsPayload, sendOwnerAlert } from '@/lib/operations';
import { readStore } from '@/lib/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const action = z.object({ action: z.enum(['alert', 'mark_interrupted']), runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();

export async function GET(request: Request) {
  try { requireOwner(request); return Response.json(await operationsPayload(), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireOwner(request); requireSameOrigin(request);
    const body = action.parse(JSON.parse(await readBoundedBody(request, 4000)));
    if (body.action === 'alert') return Response.json(await sendOwnerAlert(body.runId), { headers: { 'Cache-Control': 'private, no-store' } });
    const store = await readStore();
    if (store.lease && Date.parse(store.lease.expiresAt) > Date.now()) throw new HttpError('Wait for the active newsroom run to finish before marking an interrupted record.', 409);
    const health = await operationsPayload();
    if (!health.staleRunIds.includes(body.runId)) throw new HttpError('Only an expired running record can be marked interrupted.', 409);
    await finishRunRecord(body.runId, { status: 'interrupted' });
    return Response.json(await operationsPayload(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return errorResponse(error); }
}
