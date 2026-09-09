import { errorResponse, HttpError, requireOwner, requireSameOrigin } from '@/lib/auth';
import { parseEmailFile } from '@/lib/email';
import { ingestEmail } from '@/lib/service';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    requireOwner(request);requireSameOrigin(request);
    if(Number(request.headers.get('content-length')||0)>3_000_000)throw new HttpError('Email must be smaller than 2 MB.',413);
    const reader=request.body?.getReader();
    if(!reader)throw new HttpError('Choose an .eml email.',400);
    const chunks:Uint8Array[]=[];
    let total=0;
    try {
      while(true) {
        const next=await reader.read();
        if(next.done)break;
        total+=next.value.byteLength;
        if(total>2_100_000){await reader.cancel();throw new HttpError('Email must be smaller than 2 MB.',413);}
        chunks.push(next.value);
      }
    }finally{reader.releaseLock();}
    const bounded=new Request(request.url,{method:'POST',headers:request.headers,body:Buffer.concat(chunks)});
    const form=await bounded.formData();
    const file=form.get('file');
    if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.eml')||file.size>2_000_000)throw new HttpError('Choose an .eml email smaller than 2 MB.',400);
    const {item}=await parseEmailFile(Buffer.from(await file.arrayBuffer()));
    const inserted=await ingestEmail(item);
    return Response.json({ok:true,inserted});
  }catch(error){return errorResponse(error);}
}
