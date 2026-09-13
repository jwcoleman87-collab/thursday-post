import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeStore, readStore, transact, initialStore } from '../src/lib/store';
import { closeDocuments } from '../src/lib/durable-store';
import { createState, runNewsroom, decideStory } from '../src/lib/engine';
import { createBackup, parseBackup, restoreBackupToNewSqlite } from '../src/lib/backup';
import { signSession } from '../src/lib/auth';
import { publicPayload } from '../src/lib/service';
import { GET as contextGET, POST as editorialPOST } from '../src/app/api/editorial/route';
import type { ResearchProvider, SourceItem } from '../src/lib/domain';

const directory=mkdtempSync(join(tmpdir(),'assessed-api-'));
const keys=['DATABASE_URL','VERCEL','NEWSROOM_DB_FILE','NEWSROOM_DOCUMENT_DB_FILE','AUTH_SECRET','ADMIN_PASSWORD','LOCAL_DEMO_ACCESS','NEWSROOM_DELEGATED_SCOPE_ASSESSMENT','NEWSROOM_DELEGATED_DRAFT_REVIEW'];
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
delete process.env.DATABASE_URL;delete process.env.VERCEL;
process.env.NEWSROOM_DB_FILE=join(directory,'state.sqlite');
process.env.NEWSROOM_DOCUMENT_DB_FILE=join(directory,'documents.sqlite');
process.env.AUTH_SECRET=randomBytes(32).toString('hex');process.env.ADMIN_PASSWORD=randomBytes(24).toString('hex');
process.env.LOCAL_DEMO_ACCESS='false';
const quote='The racing authority confirmed the September meeting date';
const question='Request owners and stable staff for additional profile colour.';
const source:SourceItem={id:'assessed-http-fixture',title:'Racing authority announcement',content:quote+'.',type:'official',sourceName:'HTTP fixture authority',independenceKey:'fixture-authority',url:'https://records.example.org/assessed-http-fixture',publishedAt:'2026-09-11T00:00:00Z',retrievedAt:'2026-09-11T01:00:00Z'};
const provider:ResearchProvider={async research(){return{findings:[{text:quote,quote,kind:'record_statement',sourceIds:[source.id],confidence:'high'}]};},async draft({story}){return{headline:'Fixture report',sentences:[{text:story.claims[0].text,claimIds:[story.claims[0].id]}],researchRequests:[{agentId:6,question}]};}};
beforeEach(async()=>{process.env.NEWSROOM_DELEGATED_DRAFT_REVIEW='false';process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT='false';await transact(d=>{delete d.lease;Object.assign(d,initialStore());});});
after(async()=>{await closeStore();await closeDocuments();for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}rmSync(directory,{recursive:true,force:true});});
function request(path:string,body?:unknown,auth=true,origin='https://paper.example'){
 return new Request('https://paper.example'+path,{method:body===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json',...(auth?{cookie:`newsroom_session=${signSession()}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function fixture(){
 const state=createState();await runNewsroom(state,{mode:'live',items:[source],maxRounds:1},provider);
 const story=state.stories[0];await transact(d=>{d.state=state;});
 const url=`/api/editorial?action=assessed_draft&storyId=${story.id}`;
 const response=await contextGET(request(url));assert.equal(response.status,200);
 const context=await response.json();assert.equal(context.enabled,false);
 const input={action:'assessed_draft',editorialTone:'N',storyId:story.id,expectedDraftHash:context.expectedDraftHash,expectedEvidenceFingerprint:context.expectedEvidenceFingerprint,
  headline:{text:'Authority confirms the meeting date',evidence:[{sourceId:source.id,quote}]},
  paragraphs:[{text:'According to the fixture authority, the September meeting date has been confirmed.',evidence:[{sourceId:source.id,quote}]}],
  note:'The assessor checked this fixture headline and paragraph against the complete archived statement, preserving attribution and adding no event outcome.'};
 return{story,input,url};
}
test('delegated draft API rejects unauthenticated, cross-origin, disabled and injected authority',async()=>{
 const{input,url}=await fixture(),before=await readStore();
 assert.equal((await contextGET(request(url,undefined,false))).status,401);
 assert.equal((await editorialPOST(request('/api/editorial',input,false))).status,401);
 assert.equal((await editorialPOST(request('/api/editorial',input,true,'https://attacker.example'))).status,403);
 assert.equal((await editorialPOST(request('/api/editorial',input))).status,403);
 process.env.NEWSROOM_DELEGATED_DRAFT_REVIEW='true';
 for(const extra of [{actor:'James'},{authorised:true},{factReview:{actor:'James'}},{status:'published'},{humanReviewed:true}])
  assert.equal((await editorialPOST(request('/api/editorial',{...input,...extra}))).status,400);
 assert.deepEqual(await readStore(),before);
});
test('delegated draft API rejects changed versions and active research leases',async()=>{
 const{input}=await fixture();process.env.NEWSROOM_DELEGATED_DRAFT_REVIEW='true';
 assert.equal((await editorialPOST(request('/api/editorial',{...input,expectedDraftHash:'0'.repeat(64)}))).status,409);
 assert.equal((await editorialPOST(request('/api/editorial',{...input,expectedEvidenceFingerprint:'0'.repeat(64)}))).status,409);
 await transact(d=>{d.lease={id:'test-lease',mode:'live',expiresAt:new Date(Date.now()+60000).toISOString()};});
 assert.equal((await editorialPOST(request('/api/editorial',input))).status,409);
 assert.equal((await readStore()).state.stories[0].draft!.assessorReview,undefined);
});
test('real API persistence saves attributed full prose, then scopes the optional angle, and survives backup without publication',async()=>{
 const{input,story}=await fixture();process.env.NEWSROOM_DELEGATED_DRAFT_REVIEW='true';
 const savedResponse=await editorialPOST(request('/api/editorial',input));assert.equal(savedResponse.status,200,await savedResponse.clone().text());
 let state=(await readStore()).state;let current=state.stories[0];
 assert.equal(current.draft!.body,input.paragraphs[0].text);assert.equal(current.draft!.factReview,undefined);
 assert.equal(current.draft!.assessorReview!.actor,'newsroom-assessor');assert.equal(current.status,'blocked');
 const gap=current.gaps.find(g=>g.question===question)!;
 process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT='true';
 const context=await(await contextGET(request(`/api/editorial?storyId=${story.id}&gapId=${gap.id}`))).json();
 assert.equal(context.eligible,true);
 const scope={action:'scope_assessment',storyId:story.id,gapId:gap.id,expectedDraftHash:context.expectedDraftHash,expectedEvidenceFingerprint:context.expectedEvidenceFingerprint,
  rationale:'This article reports only the authority announcement, not owners or staff. The proposed profile angle is outside this specific report.',claimIds:current.draft!.sentences.flatMap(s=>s.claimIds)};
 assert.equal((await editorialPOST(request('/api/editorial',scope))).status,200);
 state=(await readStore()).state;current=state.stories[0];assert.equal(current.status,'waiting_approval');assert.equal(state.publications.length,0);
 assert.ok(state.stories.filter(s=>s.mode==='live'&&s.draft&&['waiting_approval','published'].includes(s.status)).some(s=>s.id===story.id));
 const backup=await createBackup();assert.deepEqual(parseBackup(JSON.stringify(backup)).payload.store.state,state);
 assert.equal(restoreBackupToNewSqlite(backup,join(directory,'restored-assessed.sqlite')).verified,true);
 const publicData=JSON.stringify(await publicPayload({canReadPaid:true}));assert.ok(!publicData.includes(input.paragraphs[0].text));assert.ok(!publicData.includes(input.note));
});


test('published sources include headline-only evidence without exposing assessor notes or unpublished evidence',async()=>{
 const {input,story}=await fixture();
 const headlineQuote='The racing club announced the revised meeting programme';
 const headlineSource={...source,id:'headline-only-archive',content:headlineQuote+'.',sourceName:'Headline fixture authority',url:'https://records.example.org/headline-archive'};
 const unrelatedSource={...source,id:'unrelated-archive',content:'Unrelated source content.',url:'https://records.example.org/unrelated-archive'};
 await transact(d=>{d.state.sourceItems.push(headlineSource,unrelatedSource);d.state.stories[0].sourceItems.push(headlineSource.id,unrelatedSource.id);});
 const context=await(await contextGET(request(`/api/editorial?action=assessed_draft&storyId=${story.id}`))).json();
 process.env.NEWSROOM_DELEGATED_DRAFT_REVIEW='true';process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT='true';
 const submission={...input,expectedDraftHash:context.expectedDraftHash,expectedEvidenceFingerprint:context.expectedEvidenceFingerprint,headline:{text:'Club confirms revised programme',evidence:[{sourceId:headlineSource.id,quote:headlineQuote}]}};
 assert.equal((await editorialPOST(request('/api/editorial',submission))).status,200);
 const current=(await readStore()).state.stories[0],gap=current.gaps.find(g=>g.question===question)!;
 const scopeContext=await(await contextGET(request(`/api/editorial?storyId=${story.id}&gapId=${gap.id}`))).json();
 assert.equal((await editorialPOST(request('/api/editorial',{action:'scope_assessment',storyId:story.id,gapId:gap.id,expectedDraftHash:scopeContext.expectedDraftHash,expectedEvidenceFingerprint:scopeContext.expectedEvidenceFingerprint,rationale:'Only the club programme and authority date are reported; staff background supports no assertion.',claimIds:current.draft!.sentences.flatMap(s=>s.claimIds)}))).status,200);
 await transact(d=>{decideStory(d.state,story.id,'approve','Synthetic test-only publication.',false);});
 const paid=await publicPayload({canReadPaid:true});const urls=paid.articles[0].sources.map(s=>s.url);
 assert.ok(urls.includes(headlineSource.url));assert.ok(urls.includes(source.url));assert.ok(!urls.includes(unrelatedSource.url));
 assert.ok(!JSON.stringify(paid).includes(input.note));
 const anonymous=await publicPayload();assert.deepEqual(anonymous.articles[0].sources,[]);
});
