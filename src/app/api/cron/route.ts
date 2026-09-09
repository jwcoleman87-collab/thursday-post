import { errorResponse, requireCron } from '@/lib/auth';
import { readStore } from '@/lib/store';
import { startRun } from '@/lib/service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function GET(request:Request){
  try{
    requireCron(request);
    if(!(await readStore()).monitoring)return Response.json({skipped:true,reason:'Monitoring is paused.'});
    await startRun('live');
    return Response.json({ok:true,publishedAutomatically:false});
  }catch(error){return errorResponse(error);}
}
