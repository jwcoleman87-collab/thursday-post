import { errorResponse } from '@/lib/auth';
import { publicPayload } from '@/lib/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  try{return Response.json(await publicPayload(),{headers:{'Cache-Control':'no-store'}});}
  catch(error){return errorResponse(error);}
}
