import { errorResponse, requireOwner } from '@/lib/auth';
import { buildDashboard } from '@/lib/dashboard';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{requireOwner(request);return Response.json(await buildDashboard(),{headers:{'Cache-Control':'no-store'}});}
  catch(error){return errorResponse(error);}
}
