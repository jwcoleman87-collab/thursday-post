import {errorResponse,HttpError,requireOwner} from '@/lib/auth';
import {readStore} from '@/lib/store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  try {
    requireOwner(request);
    const {id}=await params;
    const data=await readStore();
    const item=data.state.sourceItems.find(source=>source.id===id)||data.inbox.find(source=>source.id===id);
    if(!item)throw new HttpError('Original source not found.',404);
    const original=item.email?.original || item.rawOriginal || item.content;
    const bytes=item.email?.originalEncoding==='base64'?Buffer.from(original,'base64'):Buffer.from(original,'utf8');
    return new Response(bytes,{headers:{'Content-Type':item.type==='email'?'message/rfc822':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="source-${id.replace(/[^a-zA-Z0-9_-]/g,'')}.${item.type==='email'?'eml':'txt'}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return errorResponse(error);}
}
