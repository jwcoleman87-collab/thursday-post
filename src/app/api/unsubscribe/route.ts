import { errorResponse, HttpError } from '@/lib/auth';
import { unsubscribeDelivery } from '@/lib/delivery';
import { readBoundedBody } from '@/lib/email';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" };
const html = (body: string) => `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Thursday Post · Email preferences</title><body style="background:#f4efe4;font:18px Georgia,serif;color:#24211c;max-width:640px;margin:10vh auto;padding:24px"><h1>The Thursday Post</h1>${body}</body></html>`;
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!/^[A-Za-z0-9_.-]{20,2000}$/.test(token)) return new Response(html('<p>This unsubscribe link is invalid. Contact workbenchadmin@gmail.com for help.</p>'), { status: 400, headers });
  // A GET only confirms intent; mail scanners must not unsubscribe readers.
  return new Response(html(`<h2>Stop edition emails?</h2><p>Your paid membership and website access will remain active. Manage billing separately in your account.</p><form method="POST" action="/api/unsubscribe"><input type="hidden" name="token" value="${token}"><button style="font:inherit;padding:12px 20px">Unsubscribe from edition emails</button></form>`), { headers });
}
export async function POST(request: Request) {
  try {
    const text = await readBoundedBody(request, 5000);
    const token = new URL(request.url).searchParams.get('token') || new URLSearchParams(text).get('token');
    if (!token || token.length > 2000) throw new HttpError('Invalid unsubscribe link.');
    await unsubscribeDelivery(token);
    return new Response(html('<h2>You are unsubscribed from edition emails.</h2><p>Your paid membership is unchanged. You can still read on the website while your subscription is active.</p><p><a href="/account">Manage your account</a></p>'), { headers });
  } catch (error) { return errorResponse(error); }
}
