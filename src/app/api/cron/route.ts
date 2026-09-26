import { errorResponse, requireCron } from '@/lib/auth';
import { readStore } from '@/lib/store';
import { collectSourcesOnly, startRun } from '@/lib/service';
import { processDeliveryQueue } from '@/lib/delivery';
import { runPictureDesk } from '@/lib/picture-pass';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
/** The picture desk uses the snapshot this route already read: no extra database read, and one write only when a story was checked. */
async function pictures(publications:Awaited<ReturnType<typeof readStore>>['state']['publications'],deadline:number){
  if(process.env.NEWSROOM_PICTURE_DESK==='false'||Date.now()>deadline-40_000)return {checked:0,added:0};
  try{return await runPictureDesk(publications,{limit:3,deadline});}catch{return {checked:0,added:0,error:'Picture desk unavailable this run.'};}
}
export async function GET(request:Request){
  try{
    requireCron(request);
    const deadline=Date.now()+270_000;
    // Only resume jobs already created by James's explicit SEND action. Never create a campaign here.
    const delivery=await processDeliveryQueue({limit:2});
    const snapshot=await readStore();
    if(!snapshot.monitoring)return Response.json({ok:true,skipped:true,reason:'Source monitoring is paused; previously authorized delivery jobs were checked.',delivery,publishedAutomatically:false});
    if(process.env.NEWSROOM_AI_PAUSED==='true'){
      const collection=await collectSourcesOnly({deadline});
      return Response.json({ok:true,mode:'collect',collection,delivery,pictures:await pictures(snapshot.state.publications,deadline),publishedAutomatically:false});
    }
    await startRun('live',{deadline});
    return Response.json({ok:true,mode:'live',delivery,pictures:await pictures(snapshot.state.publications,deadline),publishedAutomatically:false});
  }catch(error){return errorResponse(error);}
}
