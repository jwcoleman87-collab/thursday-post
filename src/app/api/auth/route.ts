import { authenticate, errorResponse, requireSameOrigin } from '@/lib/auth';
import { z } from 'zod';
import { readBoundedBody } from '@/lib/email';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    requireSameOrigin(request);
    const body=z.object({password:z.string().max(512)}).parse(JSON.parse(await readBoundedBody(request,4096)));
    const token=await authenticate(request,body.password);
    return Response.json({ok:true},{headers:{'Set-Cookie':`newsroom_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.VERCEL?'; Secure':''}`}});
  }catch(error){return errorResponse(error);}
}
export async function DELETE(request:Request){
  try{requireSameOrigin(request);return Response.json({ok:true},{headers:{'Set-Cookie':'newsroom_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}});}
  catch(error){return errorResponse(error);}
}
