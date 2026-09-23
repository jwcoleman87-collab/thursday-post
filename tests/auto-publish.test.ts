import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createState,runNewsroom} from '../src/lib/engine';
import {readStore,transact,closeStore} from '../src/lib/store';
import {closeDocuments} from '../src/lib/durable-store';
import {startRun,publicPayload} from '../src/lib/service';
import {buildDashboard} from '../src/lib/dashboard';
import type {AutonomousArticle} from '../src/lib/autonomous-contract';

const passage='Official records state that the course reopened after routine maintenance.';
const source={id:'auto-source',title:'Horse racing course reopens',content:passage,url:'https://racing-authority.test/record',type:'official' as const,sourceName:'Fixture Authority',independenceKey:'fixture',publishedAt:'2026-09-13T01:00:00Z',retrievedAt:'2026-09-13T01:01:00Z'};
const evidence=[{sourceId:source.id,quote:passage}];
const research=async()=>({findings:[{text:passage,kind:'record_statement' as const,quote:passage,sourceIds:[source.id],contradictorySourceIds:[],questions:[],confidence:'high' as const}]});

async function scheduledRun(tone:'A'|'B'|'N',autoPublish?:boolean){
  const folder=mkdtempSync(join(tmpdir(),'auto-publish-'));const saved={...process.env};
  try{
    delete process.env.DATABASE_URL;delete process.env.VERCEL;
    process.env.NEWSROOM_DB_FILE=join(folder,'state.sqlite');process.env.NEWSROOM_DOCUMENT_DB_FILE=join(folder,'documents.sqlite');
    process.env.NEWSROOM_AUTONOMOUS_AGENTS='true';process.env.NEWSROOM_AI_PAUSED='false';process.env.NEWSROOM_MODEL='openai/unit-test';process.env.AI_GATEWAY_API_KEY='synthetic-unit-test';
    const state=createState();
    await runNewsroom(state,{mode:'live',items:[source],maxRounds:1,maxResearchTasks:6},{research});
    state.stories[0].status='blocked';
    await transact(data=>{data.state=state;data.inbox=[];data.sources=[];delete data.lease;if(autoPublish!==undefined)data.autoPublish=autoPublish;});
    const article:AutonomousArticle={headline:{text:'Authority reports reopening',evidence},paragraphs:[{text:'The authority reported that the course had reopened following routine work.',evidence}],editorialTone:tone};
    await startRun('live',{collect:async()=>({items:[],errors:[]}),createProvider:()=>({research,usage:[],preflight:async()=>{},
      composeArticle:async()=>article,
      reviewArticle:async input=>({fields:[0,1].map(index=>({index,supported:true,complete:true,reason:'Archive supports attributed wording.'})),datesAppropriate:true,editorialTone:tone,gaps:input.gaps.map(g=>({gapId:g.id,outcome:'optional' as const,rationale:'The checked article makes no assertion depending on this question.',evidence})),research:[],summary:'The independent PE checked every field against the archived statement and date.'})})});
    await closeStore();
    const store=await readStore();
    return {store,dashboard:await buildDashboard(),reader:await publicPayload()};
  }finally{
    await closeStore();await closeDocuments();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);rmSync(folder,{recursive:true,force:true});
  }
}

test('a desk-checked neutral article publishes automatically and is free to read',async()=>{
  const {store,dashboard,reader}=await scheduledRun('N');
  assert.equal(store.state.stories[0].status,'published');
  assert.equal(store.state.publications.length,1);
  assert.equal(store.state.publications[0].access,'public');
  assert.match(store.state.stories[0].approvals.at(-1)!.note,/standing instruction/);
  assert.equal(reader.articles[0].locked,false);
  assert.equal(reader.articles[0].paragraphs.length,1);
  assert.equal(dashboard.needsYou.length,0);
  assert.equal(dashboard.published[0].headline,'Authority reports reopening');
});

test('an adverse article waits for James with a plain reason, even with automatic publishing on',async()=>{
  const {store,dashboard}=await scheduledRun('B');
  assert.equal(store.state.publications.length,0);
  assert.equal(dashboard.published.length,0);
  assert.ok(dashboard.inProgress.length+dashboard.needsYou.length>=1);
});

test('turning automatic publishing off leaves checked articles waiting for one-tap approval',async()=>{
  const {store,dashboard}=await scheduledRun('N',false);
  assert.equal(store.state.stories[0].status,'waiting_approval');
  assert.equal(store.state.publications.length,0);
  assert.equal(dashboard.needsYou.length,1);
  assert.equal(dashboard.needsYou[0].action,'approve');
});
