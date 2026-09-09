import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {closeStore,readStore,transact} from '../src/lib/store';
import {closeDocuments} from '../src/lib/durable-store';
import {handleAction,ingestEmail,publicPayload,startRun} from '../src/lib/service';
import {parseEmailFile} from '../src/lib/email';
import {requireOwner,requireSameOrigin,requireCron,signSession,validSession} from '../src/lib/auth';

const folder=mkdtempSync(join(tmpdir(),'racing-desk-test-'));
process.env.NEWSROOM_DB_FILE=join(folder,'state.sqlite');
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.AUTH_SECRET=randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD=randomBytes(24).toString('hex');
process.env.LOCAL_DEMO_ACCESS='false';
after(async()=>{await closeDocuments();await closeStore();rmSync(folder,{recursive:true,force:true});});

test('persistent service: GO, restart, reviewed draft hash, private demo publication and deduplication',async()=>{
  await startRun('demo');
  let data=await readStore();
  const story=data.state.stories.find(s=>s.status==='waiting_approval');
  assert.ok(story?.draft);
  const reviewedHash=story.draft.hash;
  assert.equal(data.lease,undefined);
  assert.equal((await publicPayload()).articles.length,0);
  const revision=data.revision;
  await closeStore();
  data=await readStore();
  assert.equal(data.revision,revision);
  assert.equal(data.state.stories.find(s=>s.id===story.id)?.draft?.hash,story.draft.hash);
  await assert.rejects(()=>handleAction({action:'decision',storyId:story.id,decision:'approve',expectedDraftHash:'stale'}),/draft has changed/);
  await handleAction({action:'decision',storyId:story.id,decision:'approve',expectedDraftHash:reviewedHash});
  assert.equal((await publicPayload()).articles.length,0,'Demo data must never enter the public API');
  const count=(await readStore()).state.stories.length;
  await startRun('demo');
  assert.equal((await readStore()).state.stories.length,count);
  await assert.rejects(()=>handleAction({action:'decision',storyId:story.id,decision:'approve',expectedDraftHash:reviewedHash}),/final decision/);
});

test('durable lease prevents overlapping GO and approval races',async()=>{
  await transact(data=>{data.lease={id:'other-run',mode:'demo',expiresAt:new Date(Date.now()+60000).toISOString()};});
  await assert.rejects(()=>startRun('demo'),/run is in progress/);
  await assert.rejects(()=>handleAction({action:'decision',storyId:'any',decision:'reject'}),/run is in progress/);
  await transact(data=>{delete data.lease;});
});

test('a concurrent inbox arrival retains its audit event through run checkpoints',async()=>{
  const {item}=await parseEmailFile('From: Audit <audit@example.org>\r\nMessage-ID: <concurrent-inbox@example.org>\r\nSubject: Thoroughbred racing tip\r\n\r\nPlease investigate this unverified lead.');
  await Promise.all([startRun('demo'),ingestEmail(item)]);
  const data=await readStore();
  assert.ok(data.inbox.some(email=>email.id===item.id));
  assert.ok(data.state.audit.some(entry=>entry.action==='email_received'&&entry.detail.includes(item.id)));
});

test('email persists original and corrections, replay deduplicates, public projection omits private mail',async()=>{
  const raw='From: Reader <reader@example.org>\r\nTo: editor@example.org\r\nMessage-ID: <racing-correction@example.org>\r\nSubject: Correction: thoroughbred track report\r\nDate: Wed, 09 Sep 2026 10:00:00 +0000\r\n\r\nI witnessed a different track condition; please investigate.';
  const {item}=await parseEmailFile(raw);
  assert.equal(item.isCorrection,true);
  assert.equal(await ingestEmail(item),true);
  assert.equal(await ingestEmail(item),false);
  assert.ok((await readStore()).inbox.some(email=>email.email?.messageId==='<racing-correction@example.org>'));
  assert.ok(!JSON.stringify(await publicPayload()).includes('reader@example.org'));
});

test('auth denies anonymous hosted access, rejects forged/expired sessions and cross-origin writes',()=>{
  const token=signSession();
  assert.equal(validSession(token),true);
  assert.equal(validSession(token+'forged'),false);
  assert.equal(validSession(signSession(Date.now()-9*60*60*1000)),false);
  assert.throws(()=>requireOwner(new Request('https://newsroom.example/api/newsroom')),/Sign in/);
  assert.doesNotThrow(()=>requireOwner(new Request('https://newsroom.example/api/newsroom',{headers:{cookie:`newsroom_session=${token}`}})));
  assert.throws(()=>requireSameOrigin(new Request('https://newsroom.example/api/newsroom',{headers:{origin:'https://attacker.example'}})),/must come from/);
  assert.throws(()=>requireSameOrigin(new Request('https://newsroom.example/api/newsroom')),/must come from/);
  assert.doesNotThrow(()=>requireSameOrigin(new Request('https://newsroom.example/api/newsroom',{headers:{origin:'https://newsroom.example'}})));
  assert.doesNotThrow(()=>requireSameOrigin(new Request('http://localhost:3000/api/newsroom',{headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'}})));
  assert.throws(()=>requireSameOrigin(new Request('http://localhost:3000/api/newsroom',{headers:{host:'127.0.0.1:3000',origin:'http://attacker.example'}})),/must come from/);
  process.env.CRON_SECRET=randomBytes(32).toString('hex');
  assert.throws(()=>requireCron(new Request('https://newsroom.example/api/cron')),/Unauthorized/);
  assert.doesNotThrow(()=>requireCron(new Request('https://newsroom.example/api/cron',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}})));
});

test('transaction rollback and input validation preserve state',async()=>{
  const previous=await readStore();
  await assert.rejects(()=>transact(data=>{data.monitoring=!data.monitoring;throw new Error('abort');}),/abort/);
  assert.equal((await readStore()).monitoring,previous.monitoring);
  await assert.rejects(()=>handleAction({action:'source',source:{name:'private',url:'http://127.0.0.1',type:'official',adapter:'html',enabled:true}}));
  await assert.rejects(()=>handleAction({action:'decision',storyId:'missing',decision:'send_back',note:''}),/Describe the exact/);
});

test('paused live AI performs no network requests or workflow mutations',async()=>{
  const previous=await readStore();
  const paused=process.env.NEWSROOM_AI_PAUSED;
  const originalFetch=globalThis.fetch;
  let calls=0;
  process.env.NEWSROOM_AI_PAUSED='true';
  globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network call');};
  try {
    await assert.rejects(()=>startRun('live'),/paused at James/);
    assert.equal(calls,0);
    assert.equal((await readStore()).revision,previous.revision);
  } finally {
    globalThis.fetch=originalFetch;
    if(paused===undefined)delete process.env.NEWSROOM_AI_PAUSED;else process.env.NEWSROOM_AI_PAUSED=paused;
  }
});

test('Gateway verification failure stops before collection and releases the durable lease',async()=>{
  const saved=Object.fromEntries(['AI_GATEWAY_API_KEY','NEWSROOM_MODEL','NEWSROOM_AI_PAUSED'].map(key=>[key,process.env[key]]));
  process.env.AI_GATEWAY_API_KEY='test-placeholder';
  process.env.NEWSROOM_MODEL='test/provider-model';
  process.env.NEWSROOM_AI_PAUSED='false';
  const originalFetch=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(input)=>{
    calls++;
    assert.equal(String(input),'https://ai-gateway.vercel.sh/v1/chat/completions');
    return Response.json({error:{type:'customer_verification_required'}},{status:403});
  };
  try {
    await assert.rejects(()=>startRun('live'),/valid credit card/);
    const data=await readStore();
    assert.equal(calls,1);
    assert.equal(data.lease,undefined);
    assert.ok(data.state.audit.some(entry=>entry.action==='run_failed'&&entry.detail.includes('valid credit card')));
  } finally {
    globalThis.fetch=originalFetch;
    for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
