import { errorResponse } from '@/lib/auth';
import { publicPayload } from '@/lib/service';
import {currentMember,hasPaidAccess} from '@/lib/members';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{const member=await currentMember(request);return Response.json(await publicPayload({canReadPaid:member?hasPaidAccess(member):false}),{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});}
  catch(error){return errorResponse(error);}
}
