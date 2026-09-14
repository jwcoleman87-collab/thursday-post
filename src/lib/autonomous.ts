import { createHash } from 'node:crypto';
import type { NewsroomState, Story, ResearchProvider, TargetedRetriever, PeAgentId } from './domain';
import { AutonomousArticleSchema, AutonomousReviewSchema, nextIssueDate, type AutonomousContext, type AutonomousProgress, type AutonomousProvider } from './autonomous-contract';
import { BUDGET, sourceItems, evidenceFingerprint, operationalGap, agentFollowupGap, resolveTask, addSource, audit, transition, draftStory, recordAssessedDraft, assessedDraftContext, recordScopeAssessment, scopeAssessmentContext, addGap, verifiedClaim } from './engine';

const now=()=>new Date().toISOString();
const hash=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
const commission=(story:Story,agentId:number)=>story.researchAgentIds.includes(agentId as never);
const ownGap=(gap:Story['gaps'][number])=>gap.question.startsWith('James requests:');

/** This predicate is scheduling, not permission to clear an evidence question. */
export function autonomousRetryable(state:NewsroomState,story:Story):boolean {
  if(story.mode!=='live'||['published','rejected','waiting_approval'].includes(story.status))return false;
  const p=story.autonomy;
  return !p||p.phase!=='held'||p.basis!==evidenceFingerprint(state,story)||p.draftBasis!==(story.draft?.hash??'')||p.issueDate!==nextIssueDate();
}

function progress(state:NewsroomState,story:Story):AutonomousProgress {
  const basis=evidenceFingerprint(state,story),draftBasis=story.draft?.hash??'',issueDate=nextIssueDate();
  if(!story.autonomy||story.autonomy.basis!==basis||story.autonomy.draftBasis!==draftBasis||story.autonomy.issueDate!==issueDate){
    const old=story.autonomy;
    if(old)audit(state,'autonomy.version_changed',JSON.stringify({phase:old.phase,basis:old.basis,draftBasis:old.draftBasis,issueDate:old.issueDate}),story.id);
    story.autonomy={phase:'research',issueDate,basis,draftBasis,attempts:0,feedback:[],reviewerId:(story.peAgentId%4+1),updatedAt:now()};
  }
  return story.autonomy;
}

/** Targeted retrieval runs on later invocations too, not only a second in-memory round. */
export async function prepareAutonomousResearch(state:NewsroomState,story:Story,retrieve:TargetedRetriever|undefined,deadline:number,save:()=>Promise<void>):Promise<void>{
  const p=progress(state,story);
  const gaps=story.gaps.filter(g=>g.status==='open'&&g.blocking&&!g.scopeAssessment&&!operationalGap(state,story,g));
  if(!retrieve||!gaps.length||p.retrievalBasis===p.basis||Date.now()+1000>=deadline)return;
  const previous=p.basis;
  const result=await retrieve({story:structuredClone(story),questions:gaps.slice(0,6).map(g=>g.question),sourceItems:structuredClone(sourceItems(state,story)),maxItems:BUDGET.maxAdditionalSources,deadline:Math.min(deadline,Date.now()+BUDGET.retrievalTimeoutMs)});
  let added=0;
  for(const item of result.items.filter(i=>!story.sourceItems.includes(i.id)).slice(0,BUDGET.maxAdditionalSources)){
    addSource(state,item,'live');story.sourceItems.push(item.id);added++;
    for(const media of item.media??[])if(!story.media.some(m=>m.id===media.id))story.media.push({...structuredClone(media),allowed:false});
  }
  const fresh=progress(state,story);fresh.retrievalBasis=fresh.basis;
  audit(state,'autonomy.targeted_retrieval',JSON.stringify({before:previous,after:fresh.basis,added,errors:result.errors?.length??0}),story.id);
  await save();
}

function context(state:NewsroomState,story:Story,p:AutonomousProgress):AutonomousContext{
  // The writer and checker see the same bounded archived material. No URLs are fetched by the model.
  const sources=sourceItems(state,story).filter(s=>!s.demo&&s.type!=='email'&&s.type!=='social')
    .slice(-3).map(s=>({id:s.id,sourceName:s.sourceName,url:s.url,type:s.type,publishedAt:s.publishedAt,publishedAtKnown:s.publishedAtKnown,retrievedAt:s.retrievedAt,content:s.content.slice(0,4000)}));
  return {storyId:story.id,title:story.title.slice(0,300),issueDate:p.issueDate,asOf:now(),writerId:story.peAgentId,reviewerId:p.reviewerId as PeAgentId,sources,
    gaps:story.gaps.filter(g=>g.status==='open'&&g.blocking).slice(0,12).map(g=>({id:g.id,question:g.question,agentId:g.agentId,scopeEligible:agentFollowupGap(story,g)&&!operationalGap(state,story,g)})),feedback:p.feedback.slice(0,6)};
}

function referencesValid(input:AutonomousContext,references:{sourceId:string;quote:string}[]):boolean{
  return references.every(r=>r.quote.trim().split(/\s+/).length<=25&&input.sources.some(s=>s.id===r.sourceId&&s.content.includes(r.quote)));
}

async function timed<T>(work:()=>Promise<T>,deadline:number):Promise<T>{
  if(Date.now()+1000>=deadline){const error=new Error('The next stage is saved for a later bounded run.');error.name='GatewayCapacityError';throw error;}
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Autonomous stage timed out.')),Math.min(BUDGET.taskTimeoutMs,deadline-Date.now()));})]);}
  finally{clearTimeout(timer);}
}

function reject(state:NewsroomState,story:Story,p:AutonomousProgress,reasons:string[]){
  p.attempts++;p.feedback=reasons.slice(0,10);p.phase=p.attempts>=2?'held':'compose';delete p.proposal;p.updatedAt=now();
  audit(state,'autonomy.revision_required',JSON.stringify({phase:p.phase,attempt:p.attempts,reasons:p.feedback}),story.id);
  transition(state,story,'blocked',p.phase==='held'?'Automated editorial review could not substantiate this version. Evidence and exact blockers are retained; other stories may proceed.':'PE writer will revise the checked defects on the next bounded run.');
}

/**
 * Writer and reviewer are separate model invocations and different PE roles. Only this
 * server controller applies validated results. Neither model gets application tools,
 * owner cookies, publish/send authority, or a way to assert a James factReview.
 */
export async function finishAutonomousStory(state:NewsroomState,story:Story,provider:ResearchProvider,deadline:number,save:()=>Promise<void>):Promise<void>{
  let p=progress(state,story);
  const worker=provider as ResearchProvider&Partial<AutonomousProvider>;
  if(!worker.composeArticle||!worker.reviewArticle)throw new Error('Autonomous PE writer and checker are not configured.');
  // Any research deferred by the existing controller remains a genuine blocker.
  if(story.gaps.some(g=>g.status==='open'&&g.blocking&&operationalGap(state,story,g))){
    p.phase='research';transition(state,story,'blocked','Assigned researchers still have outstanding work. Editorial model calls are deferred.');await save();return;
  }
  if(!story.draft){
    await draftStory(state,story,{research:provider.research.bind(provider)},deadline);
    p=progress(state,story);
  }
  transition(state,story,'blocked','Autonomous editorial preparation is in progress; no publication permission is granted.');
  p.phase=p.proposal?'review':'compose';await save();
  const input=context(state,story,p);
  if(!input.sources.length){reject(state,story,p,['No public archived material is available for a sourced article.']);p.phase='held';await save();return;}
  const runStage=async<T>(stage:'compose'|'review',agentId:number,fn:()=>Promise<T>):Promise<T>=>{
    const startedAt=now();
    try{
      const value=await timed(fn,deadline);
      state.runs.push({id:`auto-${hash([story.id,p.basis,stage,p.attempts,state.runs.length]).slice(0,20)}`,storyId:story.id,agentType:'editorial',agentId,status:'completed',summary:`Autonomous ${stage}; PE Agent ${agentId}; issue ${p.issueDate}.`,startedAt,finishedAt:now()});
      return value;
    }catch(error){
      if(error instanceof Error&&error.name==='GatewayCapacityError')throw error;
      state.runs.push({id:`auto-${hash([story.id,stage,state.runs.length]).slice(0,20)}`,storyId:story.id,agentType:'editorial',agentId,status:'failed',summary:`Autonomous ${stage} did not complete; no article accepted.`,startedAt,finishedAt:now()});throw error;
    }
  };
  try{
    if(!p.proposal){
      const article=AutonomousArticleSchema.parse(await runStage('compose',story.peAgentId,()=>worker.composeArticle!(input)));
      if(![article.headline,...article.paragraphs].every(f=>referencesValid(input,f.evidence))||article.headline.text.length>160||article.paragraphs.some(f=>!/[.!?][”"’']?$/.test(f.text))){
        reject(state,story,p,['Writer returned incomplete prose or a passage absent from the supplied archive.']);await save();return;
      }
      p.proposal=article;p.phase='review';p.updatedAt=now();await save();
    }
    const article=p.proposal;
    const review=AutonomousReviewSchema.parse(await runStage('review',p.reviewerId,()=>worker.reviewArticle!({...input,article})));
    p.review=review;p.updatedAt=now();await save();
    if(p.basis!==evidenceFingerprint(state,story)||p.draftBasis!==story.draft!.hash)throw new Error('Editorial input version changed; review must be repeated.');
    const count=article.paragraphs.length+1;
    const fields=new Map(review.fields.map(f=>[f.index,f]));
    const reasons:string[]=[];
    if(fields.size!==count||review.fields.length!==count||Array.from({length:count},(_,i)=>i).some(i=>!fields.has(i)))reasons.push('The checking PE did not review every headline and paragraph exactly once.');
    for(const field of review.fields)if(!field.supported||!field.complete)reasons.push(`Field ${field.index}: ${field.reason}`);
    if(!review.datesAppropriate)reasons.push('The proposed reporting is not accurate for this issue date. Obtain current evidence or correct the tense.');
    if(review.editorialTone!==article.editorialTone)reasons.push('Writer and checker disagree on adverse-reporting classification.');
    if(review.gaps.length!==new Set(review.gaps.map(g=>g.gapId)).size||review.gaps.some(g=>!input.gaps.some(x=>x.id===g.gapId)||!referencesValid(input,g.evidence)))reasons.push('Checker returned duplicate, unknown or unsupported gap decisions.');
    if(reasons.length){reject(state,story,p,reasons);await save();return;}
    if(review.research.length){
      for(const request of review.research)addGap(state,story,request.question,request.agentId as never,true,`editorial-${request.question}`);
      const fresh=progress(state,story);fresh.attempts=p.attempts+1;fresh.phase=fresh.attempts>=2?'held':'research';fresh.feedback=review.research.map(r=>r.question);delete fresh.retrievalBasis;
      transition(state,story,'blocked','Checking PE commissioned specific additional evidence; registered-source retrieval and researchers resume it.');await save();return;
    }
    // Plan the whole acceptance on a clone. A failed disposition cannot partly save a draft.
    const planned=structuredClone(state),candidate=planned.stories.find(s=>s.id===story.id)!;
    for(const decision of review.gaps.filter(g=>g.outcome==='answered')){
      const gap=candidate.gaps.find(g=>g.id===decision.gapId)!;
      if(!agentFollowupGap(candidate,gap)||!decision.evidence.length)continue;
      const claimIds=candidate.claims.filter(c=>verifiedClaim(planned,candidate,c.id)&&decision.evidence.some(r=>c.evidence.some(e=>e.sourceId===r.sourceId&&e.quote===r.quote&&e.exactMatch))).map(c=>c.id);
      if(!claimIds.length)continue;
      gap.status='resolved';gap.claimIds=claimIds;gap.resolution=`Research findings checked by PE Agent ${p.reviewerId}: ${decision.rationale}`;
      audit(planned,'autonomy.question_answered',JSON.stringify({gapId:gap.id,claimIds,reviewerId:p.reviewerId,sourceScope:'source_statement',rationale:decision.rationale}),story.id);
    }
    const bindings=assessedDraftContext(planned,story.id);
    recordAssessedDraft(planned,story.id,{expectedDraftHash:bindings.expectedDraftHash,expectedEvidenceFingerprint:bindings.expectedEvidenceFingerprint,...article,note:`Autonomous PE writer ${story.peAgentId}, independent checking PE ${p.reviewerId}; issue ${p.issueDate}. ${review.summary}`},true);
    for(const decision of review.gaps.filter(g=>g.outcome==='optional')){
      const gap=candidate.gaps.find(g=>g.id===decision.gapId)!;
      if(!gap||gap.status!=='open'||!agentFollowupGap(candidate,gap))continue;
      const bindings=scopeAssessmentContext(planned,story.id,gap.id);
      if(!bindings.eligible)continue;
      const claimIds=candidate.draft!.sentences.flatMap(s=>s.claimIds).filter(id=>candidate.claims.find(c=>c.id===id)?.evidence.some(e=>decision.evidence.some(r=>r.sourceId===e.sourceId&&r.quote===e.quote)));
      if(!claimIds.length)continue;
      recordScopeAssessment(planned,story.id,gap.id,{rationale:`Independent PE Agent ${p.reviewerId}: ${decision.rationale}`,claimIds:[...new Set(claimIds)],expectedDraftHash:bindings.expectedDraftHash,expectedEvidenceFingerprint:bindings.expectedEvidenceFingerprint},true);
    }
    const accepted=planned.stories.find(s=>s.id===story.id)!;
    accepted.autonomy={...p,proposal:article,review,phase:accepted.status==='waiting_approval'?'ready':'held',basis:evidenceFingerprint(planned,accepted),draftBasis:accepted.draft!.hash,updatedAt:now()};
    audit(planned,'autonomy.editorial_checked',JSON.stringify({writerId:story.peAgentId,reviewerId:p.reviewerId,issueDate:p.issueDate,draftHash:accepted.draft!.hash,status:accepted.status,blockingQuestions:accepted.gaps.filter(g=>g.status==='open'&&g.blocking&&!g.scopeAssessment).map(g=>g.id)}),story.id);
    for(const key of Object.keys(story))if(!(key in accepted))delete (story as unknown as Record<string,unknown>)[key];
    Object.assign(story,accepted);state.audit=planned.audit;await save();
  }catch(error){
    if(error instanceof Error&&['GatewayCapacityError','GatewayAccessError'].includes(error.name)){
      audit(state,'autonomy.stage_deferred',`Phase ${p.phase} is checkpointed; provider allowance or cooldown prevents another call.`,story.id);await save();throw error;
    }
    reject(state,story,p,['The structured editorial check or evidence binding did not validate. No unchecked draft was accepted.']);await save();
  }
}
