import {z} from 'zod';
import {requireOwner,requireSameOrigin,errorResponse,HttpError} from '@/lib/auth';
import {readBoundedBody} from '@/lib/email';
import {transact} from '@/lib/store';
import {newsroomPayload} from '@/lib/service';
import {resolveStoryGap,editStoryDraft,recordRightOfReply,createCorrectionStory,setPublicationStatus,setPublicationAccess} from '@/lib/engine';
const note=z.string().trim().min(8).max(3000);
const ids=z.array(z.string().min(1)).max(40);
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('resolve_gap'),storyId:z.string(),gapId:z.string(),note,claimIds:ids.min(1),expectedDraftHash:z.string().optional()}),
  z.object({action:z.literal('edit_draft'),storyId:z.string(),headline:z.string().trim().min(5).max(180),sentences:z.array(z.object({text:z.string().trim().min(1).max(3000),claimIds:ids.min(1)})).min(1).max(30),note,humanReviewed:z.literal(true),expectedDraftHash:z.string(),deck:z.string().max(500).optional(),dateline:z.string().max(120).optional(),label:z.enum(['analysis','opinion','update','correction','right_of_reply']).optional(),editorialTone:z.enum(['A','B','N']).optional(),access:z.enum(['public','members']).optional()}),
  z.object({action:z.literal('right_of_reply'),storyId:z.string(),status:z.enum(['not_required','requested','received','declined','no_response']),note,recipient:z.string().max(200).optional(),requestedAt:z.iso.datetime().optional(),deadline:z.iso.datetime().optional(),sourceIds:ids,expectedDraftHash:z.string()}),
  z.object({action:z.literal('correction'),publicationId:z.string(),reason:note,sourceIds:ids.optional(),headline:z.string().max(180).optional()}),
  z.object({action:z.literal('publication_status'),publicationId:z.string(),status:z.enum(['published','retracted','removed']),note}),
  z.object({action:z.literal('publication_access'),publicationId:z.string(),access:z.enum(['public','members']),note})
]);
export const runtime='nodejs';
export async function POST(request:Request){try{
  requireOwner(request);requireSameOrigin(request);
  const input=schema.parse(JSON.parse(await readBoundedBody(request,150000)));
  await transact(data=>{
    if(data.lease&&Date.parse(data.lease.expiresAt)>Date.now())throw new HttpError('Wait for the running research cycle before editing.',409);
    try{
      switch(input.action){
        case'resolve_gap':resolveStoryGap(data.state,input.storyId,input.gapId,input);break;
        case'edit_draft':editStoryDraft(data.state,input.storyId,input);break;
        case'right_of_reply':recordRightOfReply(data.state,input.storyId,input);break;
        case'correction':createCorrectionStory(data.state,input.publicationId,input);break;
        case'publication_status':setPublicationStatus(data.state,input.publicationId,input);break;
        case'publication_access':setPublicationAccess(data.state,input.publicationId,input);break;
      }
    }catch(error){throw new HttpError(error instanceof Error?error.message:'Editorial change failed.',409);}
  });
  return Response.json(await newsroomPayload(),{headers:{'Cache-Control':'no-store'}});
}catch(error){return errorResponse(error);}}
