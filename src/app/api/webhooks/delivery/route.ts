import { errorResponse } from '@/lib/auth';
import { receiveDeliveryWebhook } from '@/lib/delivery';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { return Response.json(await receiveDeliveryWebhook(request)); }
  catch (error) { return errorResponse(error); }
}
