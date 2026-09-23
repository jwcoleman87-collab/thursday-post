import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLiveProvider,GatewayCapacityError} from '../src/lib/providers';
import {createState,runNewsroom,addGap} from '../src/lib/engine';
import {readStore,transact,closeStore} from '../src/lib/store';
import {closeDocuments} from '../src/lib/durable-store';
import {startRun,newsroomPayload} from '../src/lib/service';
import {createBackup,parseBackup} from '../src/lib/backup';
import type {AutonomousContext,AutonomousArticle} from '../src/lib/autonomous-contract';
const passage='Official records state that the course reopened after routine maintenance.';
const source={id:'auto-source',title:'Horse racing course reopens',content:passage,url:'https://racing-authority.test/record',type:'official' as const,sourceName:'Fixture Authority',independenceKey:'fixture',publishedAt:'2026-09-13T01:00:00Z',retrievedAt:'2026-09-13T01:01:00Z'};
const evidence=[{sourceId:source.id,quote:passage}];
const article:AutonomousArticle={headline:{text:'Authority reports reopening',evidence},paragraphs:[{text:'The authority reported that the course had reopened following routine work.',evidence}],editorialTone:'N'};
const context:AutonomousContext={storyId:'fixture',title:source.title,issueDate:'2026-09-17',asOf:'2026-09-14T00:00:00Z',writerId:2,reviewerId:3,sources:[source],gaps:[],feedback:[]};
const response=(value:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:20}}),{status:200});
test('autonomous gateway dispatch cap counts preflight, writing and checking, not only researchers',async()=>{
 const systems:string[]=[];
 const provider=createLiveProvider({apiKey:'synthetic-unit-test',model:'openai/unit-test',maxRequests:4,transport:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));systems.push(body.messages[0].content);
  if(systems.length===1)return response({ok:true});
  if(body.messages[0].content.includes('WRITING desk'))return response(article);
  return response({fields:[0,1].map(index=>({index,supported:true,complete:true,reason:'Source supports the field.'})),datesAppropriate:true,editorialTone:'N',gaps:[],research:[],summary:'Each assertion was checked against the exact supplied source.'});
 }});
 await provider.preflight();await provider.composeArticle!(context);await provider.reviewArticle!({...context,article});await provider.composeArticle!(context);
 await assert.rejects(()=>provider.reviewArticle!({...context,article}),GatewayCapacityError);
 assert.equal(systems.length,4);assert.ok(systems[1].includes('Society & People'));assert.ok(systems[2].includes('Business & Technology'));assert.ok(systems[2].includes('CHECKING desk'));
 assert.equal(provider.usage.length,4);
});
test('provider-declared cooldown is persisted in full instead of being shortened to two minutes',async()=>{
 const waits:number[]=[];const before=Date.now();let calls=0;
 const provider=createLiveProvider({apiKey:'synthetic-unit-test',model:'openai/unit-test',maxRequests:4,onNotBefore:async value=>{waits.push(value);},transport:async()=>{calls++;return new Response(JSON.stringify({error:{code:'rate_limit'}}),{status:429,headers:{'retry-after':'600'}});}});
 await assert.rejects(()=>provider.preflight(),/rate limited/);assert.equal(calls,1);assert.ok(waits.at(-1)!>=before+600000);
});
test('the scheduled startRun path completes research-to-PE handoff, persists the article and resumes without an owner browser',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'autonomous-service-'));const saved={...process.env};
 try{
  delete process.env.DATABASE_URL;delete process.env.VERCEL;
  process.env.NEWSROOM_DB_FILE=join(folder,'state.sqlite');process.env.NEWSROOM_DOCUMENT_DB_FILE=join(folder,'documents.sqlite');
  process.env.NEWSROOM_AUTONOMOUS_AGENTS='true';process.env.NEWSROOM_AI_PAUSED='false';process.env.NEWSROOM_MODEL='openai/unit-test';process.env.AI_GATEWAY_API_KEY='synthetic-unit-test';
  const state=createState();
  const research=async()=>({findings:[{text:passage,kind:'record_statement' as const,quote:passage,sourceIds:[source.id],contradictorySourceIds:[],questions:[],confidence:'high' as const}]});
  await runNewsroom(state,{mode:'live',items:[source],maxRounds:1,maxResearchTasks:6},{research});
  const story=state.stories[0];addGap(state,story,'Could this also cover the founders?',2,true,'editorial-Could this also cover the founders?');story.status='blocked';
  await transact(data=>{data.state=state;data.inbox=[];data.sources=[];delete data.lease;data.autoPublish=false;});
  let writers=0,checkers=0;
  await startRun('live',{collect:async()=>({items:[],errors:[]}),createProvider:options=>{
   assert.equal(options?.maxRequests,10);
   return {research,usage:[],preflight:async()=>{},composeArticle:async()=>{writers++;return article;},reviewArticle:async input=>{checkers++;return {fields:[0,1].map(index=>({index,supported:true,complete:true,reason:'Archive supports attributed wording.'})),datesAppropriate:true,editorialTone:'N',gaps:input.gaps.map(g=>({gapId:g.id,outcome:'optional',rationale:'The checked article asserts nothing about founders or their background.',evidence})),research:[],summary:'The independent PE checked every field against the archived statement, source date and publication context.'};}};
  }});
  await closeStore();const reopened=await readStore();assert.equal(writers,1);assert.equal(checkers,1);assert.equal(reopened.state.stories[0].status,'waiting_approval');assert.equal(reopened.state.publications.length,0);
  assert.equal(reopened.state.stories[0].draft!.body,article.paragraphs[0].text);
  const backup=parseBackup(await createBackup());assert.equal(backup.payload.store.state.stories[0].autonomy?.phase,'ready');
  assert.equal((await newsroomPayload()).state.stories[0].status,'waiting_approval');
  await transact(data=>{data.state.gatewayNotBefore=Date.now()+600000;});await closeStore();
  let constructed=false;
  await assert.rejects(()=>startRun('live',{createProvider:()=>{constructed=true;throw new Error('Must not dispatch during persisted cooldown');}}),/cooldown/);assert.equal(constructed,false);
 }finally{
  await closeStore();await closeDocuments();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);rmSync(folder,{recursive:true,force:true});
 }
});


test('queued parallel callers cannot overrun the shared autonomous dispatch allowance',async()=>{
 let requests=0;
 const provider=createLiveProvider({apiKey:'synthetic-unit-test',model:'openai/unit-test',maxRequests:2,transport:async()=>{requests++;await new Promise(r=>setTimeout(r,1));return response(article);}});
 const outcomes=await Promise.allSettled(Array.from({length:6},()=>provider.composeArticle!(context)));
 assert.equal(requests,2);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,2);
});
