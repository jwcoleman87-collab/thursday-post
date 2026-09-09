import { errorResponse, requireOwner, requireSameOrigin, HttpError } from '@/lib/auth';
import { handleAction, newsroomPayload } from '@/lib/service';
import { readBoundedBody } from '@/lib/email';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request){
  try{requireOwner(request);return Response.json(await newsroomPayload(),{headers:{'Cache-Control':'no-store'}});}
  catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
  try{
    requireOwner(request);requireSameOrigin(request);
    const text=await readBoundedBody(request,20000);
    if(text.length>20000)throw new HttpError('Request too large.',413);
    await handleAction(JSON.parse(text));
    return Response.json(await newsroomPayload(),{headers:{'Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}
