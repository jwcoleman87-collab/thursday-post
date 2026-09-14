import test from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET,createState,runNewsroom,addGap,decideStory } from '../src/lib/engine';
import { nextIssueDate,type AutonomousContext,type AutonomousArticle,type AutonomousReview } from '../src/lib/autonomous-contract';
import type { SourceItem,ResearchProvider,PeAgentId } from '../src/lib/domain';

const passage='The racecourse reopened on Monday after routine maintenance was completed.';
function items(title='Veterinary horse racing community report'):SourceItem[]{
 const common={title,content:passage+' This synthetic fixture is only for automated testing.',url:'https://racing-authority.test/report',type:'official' as const,sourceName:'Fixture Racing Authority',independenceKey:'fixture-authority',publishedAt:'2026-09-13T01:00:00Z',retrievedAt:'2026-09-13T01:01:00Z',region:'NSW'};
 return [{...common,id:'official'}, {...common,id:'email',type:'email',url:'mailto:fixture@example.org',content:'An unverified eyewitness tip.'}, {...common,id:'media',type:'media',url:'https://racing-authority.test/media'}];
}
const caps={mode:'live' as const,autonomous:true,maxRounds:BUDGET.maxLiveRounds,maxResearchTasks:BUDGET.maxLiveResearchTasks,maxTaskRetries:BUDGET.maxLiveRetries};
function article():AutonomousArticle{
 const evidence=[{sourceId:'official',quote:passage}];
 return {headline:{text:'Authority reports completion of course maintenance',evidence},editorialTone:'N',paragraphs:[{text:'The racing authority reported that routine work at the course had finished.',evidence},{text:'Its statement dated the reopening to Monday.',evidence}]};
}
function review(input:AutonomousContext&{article:AutonomousArticle}):AutonomousReview{
 return {fields:[input.article.headline,...input.article.paragraphs].map((_,index)=>({index,supported:true,complete:true,reason:'Attributed statement is supported by the exact supplied official passage.'})),datesAppropriate:true,editorialTone:'N',gaps:input.gaps.map(g=>({gapId:g.id,outcome:g.scopeEligible?'optional' as const:'needs_evidence' as const,rationale:'No sentence in the article asserts anything about this additional background angle.',evidence:[{sourceId:'official',quote:passage}]})),research:[],summary:'The checking PE compared each field, attribution and source date with the archived fixture. No owner review or approval is claimed.'};
}
function worker(log:{research:number[];writers:number[];reviewers:number[]},limit=3,change?:(r:AutonomousReview)=>void):ResearchProvider{
 let used=0;
 const spend=()=>{if(used++>=limit){const e=new Error('Bounded request allowance');e.name='GatewayCapacityError';throw e;}};
 return {
  async research(request){spend();log.research.push(request.agentId);return {findings:[{text:passage,kind:'record_statement',quote:passage,sourceIds:['official'],contradictorySourceIds:[],questions:[],confidence:'high'}]};},
  async composeArticle(input){spend();assert.ok(input.sources.every(source=>['official','data','publication'].includes(source.type)));log.writers.push(input.writerId);return article();},
  async reviewArticle(input){spend();log.reviewers.push(input.reviewerId);const result=review(input);change?.(result);return result;},
 };
}
for(const [desk,title] of [[1,'Veterinary racing authority policy report'],[2,'Veterinary horse racing community report'],[3,'Veterinary horse racing business report'],[4,'Veterinary international horse racing report']] as [PeAgentId,string][]){
 test(`all six researchers hand off to PE ${desk} and a different checking PE across bounded unattended runs`,async()=>{
  const state=createState(),log={research:[] as number[],writers:[] as number[],reviewers:[] as number[]};
  for(let pass=0;pass<6&&!state.stories.some(s=>s.status==='waiting_approval');pass++){
   await runNewsroom(state,{...caps,items:pass?[]:items(title)},worker(log));
   if(pass===0){assert.equal(log.writers.length,0,'No editorial credit spent with required research deferred');addGap(state,state.stories[0],'Could the report also profile the club founder?',2,true,'editorial-Could the report also profile the club founder?');}
  }
  const story=state.stories[0];
  assert.equal(story.status,'waiting_approval',JSON.stringify({progress:story.autonomy,error:story.error,gaps:story.gaps}));
  assert.deepEqual([...new Set(log.research)].sort(),[1,2,3,4,5,6]);
  assert.equal(log.research.length,7,'Six commissions plus the separately assigned editorial question, each once');
  assert.deepEqual(log.writers,[desk],'A saved writer checkpoint is not generated again just because the checking call was deferred');
  assert.deepEqual(log.reviewers,[desk%4+1]);
  assert.ok(story.draft!.body.includes('routine work'));assert.equal(story.draft!.sentences.length,2);
  assert.equal(story.draft!.factReview,undefined);assert.equal(story.draft!.assessorReview?.actor,'newsroom-assessor');
  assert.equal(story.autonomy?.phase,'ready');assert.equal(state.publications.length,0);
  assert.ok(story.gaps.find(g=>g.scopeAssessment)?.status==='open','Optional is not falsely labelled answered');
 });
}
test('unsupported wording and stale-event tense are revised and eventually held, never published',async()=>{
 const state=createState(),log={research:[] as number[],writers:[] as number[],reviewers:[] as number[]};
 for(let pass=0;pass<8;pass++)await runNewsroom(state,{...caps,items:pass?[]:items()},worker(log,20,r=>{r.fields[0].supported=false;r.datesAppropriate=false;}));
 assert.equal(state.stories[0].status,'blocked');assert.equal(state.stories[0].autonomy?.phase,'held');assert.equal(log.writers.length,2);assert.equal(state.publications.length,0);
 assert.throws(()=>decideStory(state,state.stories[0].id,'approve','Cannot publish unchecked work',false));
});
test('a missing primary record is not waived even if the checking model calls it optional',async()=>{
 const state=createState(),log={research:[] as number[],writers:[] as number[],reviewers:[] as number[]};
 for(let pass=0;pass<6;pass++){
  if(pass===1)addGap(state,state.stories[0],'A mandatory primary record is missing.',2,true,'primary-evidence-guard');
  await runNewsroom(state,{...caps,items:pass?[]:items()},worker(log,20,r=>{for(const g of r.gaps)g.outcome='optional';}));
 }
 assert.equal(state.stories[0].status,'blocked');assert.equal(state.stories[0].gaps.find(g=>g.question==='A mandatory primary record is missing.')?.status,'open');assert.equal(state.publications.length,0);
});
test('targeted collection for a stored evidence gap occurs with the real one-round live limit',async()=>{
 const state=createState(),log={research:[] as number[],writers:[] as number[],reviewers:[] as number[]};
 await runNewsroom(state,{...caps,items:items()},worker(log));
 addGap(state,state.stories[0],'Obtain the official reopening statement.',2,true,'editorial-Obtain the official reopening statement.');
 let retrievals=0;
 await runNewsroom(state,{...caps,items:[]},worker(log),undefined,async request=>{retrievals++;assert.ok(request.questions.some(q=>q.includes('reopening')));return {items:[],errors:[]};});
 assert.equal(retrievals,1);assert.ok(state.audit.some(a=>a.action==='autonomy.targeted_retrieval'));
});
test('edition date is calculated in Sydney and given to both editorial agents',()=>{
 assert.equal(nextIssueDate(new Date('2026-09-13T23:00:00Z')),'2026-09-17');
 assert.equal(nextIssueDate(new Date('2026-09-17T15:00:00Z')),'2026-09-24');
});


test('more optional questions than fit one checking pass drain across persisted PE reviews',async()=>{
 const state=createState(),log={research:[] as number[],writers:[] as number[],reviewers:[] as number[]};
 await runNewsroom(state,{...caps,items:items()},worker(log,20));
 for(let i=0;i<14;i++){const q=`Additional founder profile angle ${i}?`;addGap(state,state.stories[0],q,2,true,`editorial-${q}`);}
 for(let pass=0;pass<20&&state.stories[0].status!=='waiting_approval';pass++)await runNewsroom(state,{...caps,items:[]},worker(log,20));
 assert.equal(state.stories[0].status,'waiting_approval',JSON.stringify(state.stories[0].autonomy));
 assert.equal(state.stories[0].gaps.filter(g=>g.scopeAssessment).length,14);
 assert.equal(log.writers.length,1);assert.equal(log.reviewers.length,2);assert.equal(state.publications.length,0);
});


test('a checker that omits an assigned gap is retried without accepting a draft or silently stranding the question',async()=>{
 const state=createState(),log={research:[] as number[],writers:[] as number[],reviewers:[] as number[]};
 await runNewsroom(state,{...caps,items:items()},worker(log,20));
 const q='Could this also profile stable staff?';addGap(state,state.stories[0],q,2,true,`editorial-${q}`);
 let checks=0;
 for(let pass=0;pass<10&&state.stories[0].status!=='waiting_approval';pass++){
   await runNewsroom(state,{...caps,items:[]},worker(log,20,r=>{if(checks++===0)r.gaps=[];}));
   if(checks===1){assert.equal(state.stories[0].autonomy?.phase,'compose');assert.equal(state.stories[0].draft?.assessorReview,undefined);}
 }
 assert.equal(checks,2);assert.equal(state.stories[0].status,'waiting_approval');assert.equal(state.publications.length,0);
 assert.ok(state.audit.some(a=>a.action==='autonomy.revision_required'&&a.detail.includes('every supplied gap')));
});
