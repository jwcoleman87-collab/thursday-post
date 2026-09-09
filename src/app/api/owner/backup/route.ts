import { errorResponse, requireOwner } from '@/lib/auth';
import { createBackup } from '@/lib/backup';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Private owner download only; there is deliberately no restore or overwrite operation over HTTP. */
export async function GET(request: Request) {
  try {
    requireOwner(request);
    const backup = await createBackup();
    const filename = `thursday-post-backup-${backup.createdAt.replace(/[:.]/g, '-')}.json`;
    return new Response(JSON.stringify(backup), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return errorResponse(error); }
}
