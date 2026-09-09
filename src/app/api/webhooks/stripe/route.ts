import { errorResponse } from '@/lib/auth';
import { receiveStripeWebhook } from '@/lib/commerce';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { return Response.json(await receiveStripeWebhook(request), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
