import { errorResponse } from '@/lib/auth';
import { getCommerceReadiness } from '@/lib/commerce';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const readiness = await getCommerceReadiness();
    return Response.json({ liveSalesEnabled: readiness.salesOpen, amount: readiness.monthlyAmount, currency: 'aud', interval: 'month', priceDisplay: readiness.monthlyAmount ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(readiness.monthlyAmount / 100) + ' AUD per month' : null, canRequestLink: readiness.memberSignInReady, blockedReason: readiness.salesOpen ? null : 'Subscriptions are being prepared. Sales will open when the monthly plan is ready.', description: 'The Thursday Post every Thursday by email, with access to the member edition archive.', mode: readiness.mode }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
