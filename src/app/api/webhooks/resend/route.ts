import { getEmailConfiguration, receiveResendWebhook } from '@/lib/email';
import { ingestEmail } from '@/lib/service';
import { errorResponse, HttpError } from '@/lib/auth';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
  try{
    if(!getEmailConfiguration().inboundConfigured)throw new HttpError('Inbound email requires Resend credentials and NEWSROOM_INBOUND_ADDRESS.',503);
    const result=await receiveResendWebhook(request);
    if(result.ignored)return Response.json({received:true,ignored:true});
    await ingestEmail(result.item);
    return Response.json({received:true});
  }catch(error){return errorResponse(error);}
}
