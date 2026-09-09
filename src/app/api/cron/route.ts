import { errorResponse, requireCron } from '@/lib/auth';
import { readStore } from '@/lib/store';
import { collectSourcesOnly, startRun } from '@/lib/service';
import { processDeliveryQueue } from '@/lib/delivery';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request){
  try{
    requireCron(request);
    const deadline=Date.now()+270_000;
    // Only resume jobs already created by James's explicit SEND action. Never create a campaign here.
    const delivery=await processDeliveryQueue({limit:2});
    if(!(await readStore()).monitoring)return Response.json({ok:true,skipped:true,reason:'Source monitoring is paused; previously authorized delivery jobs were checked.',delivery,publishedAutomatically:false});
    if(process.env.NEWSROOM_AI_PAUSED==='true'){
      const collection=await collectSourcesOnly({deadline});
      return Response.json({ok:true,mode:'collect',collection,delivery,publishedAutomatically:false});
    }
    await startRun('live',{deadline});
    return Response.json({ok:true,mode:'live',delivery,publishedAutomatically:false});
  }catch(error){return errorResponse(error);}
}
