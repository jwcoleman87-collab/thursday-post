import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import type { ArticleDraft, ResearchProvider, SourceItem } from '../src/lib/domain';
import { canonicalJson } from '../src/lib/integrity-json';
import { createState, runNewsroom, draftHash, editStoryDraft, recordAssessedDraft, assessedDraftContext, assessedDraftIntact, evidenceFingerprint, activeScopeAssessment, decideStory } from '../src/lib/engine';
import { readStore, transact, closeStore } from '../src/lib/store';
import { signSession } from '../src/lib/auth';
import { GET, POST } from '../src/app/api/editorial/route';
import { createBackup, parseBackup } from '../src/lib/backup';

// Exactly the pre-fix algorithm, retained ONLY here to reproduce the storage defect.
function legacyHash(draft: ArticleDraft): string {
  return createHash('sha256').update(JSON.stringify({ headline: draft.headline, byline: draft.byline, peAgentId: draft.peAgentId, sentences: draft.sentences, body: draft.body, limitations: draft.limitations, factReview: draft.factReview, reviewRevision: draft.reviewRevision, label: draft.label, deck: draft.deck, dateline: draft.dateline, captions: draft.captions, access: draft.access, assessorReview: draft.assessorReview })).digest('hex');
}
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k,v]) => [k,reverseKeys(v)])) as T;
  return value;
}
function sample(): ArticleDraft {
  return { id:'synthetic-draft', headline:'Synthetic trainer profile', byline:'Agent 2', peAgentId:2,
    sentences:[{text:'The trainer described patient development.',claimIds:['claim-a','claim-b'],humanReviewed:true}],
    body:'The trainer described patient development.', limitations:['Source statements, not independent proof.'],
    factReview:{actor:'James',note:'Synthetic owner review for storage testing only.',reviewedAt:'2026-09-13T02:58:07.000Z'},
    reviewRevision:1, deck:'', access:'members', hash:'', createdAt:'2026-09-13T02:58:07.000Z' };
}

test('draft serialization preserves historical writer hashes while ignoring only object key order', () => {
  const human=sample();
  const machine=sample();delete machine.factReview;delete machine.reviewRevision;delete machine.deck;
  machine.sentences=[{text:machine.body,claimIds:['claim-a']}];
  const assessed=structuredClone(machine);
  assessed.assessorReview={actor:'newsroom-assessor',authorisingOwner:'James',note:'Synthetic delegated review, not a personal owner finding.',reviewedAt:human.createdAt,evidenceFingerprint:'f'.repeat(64),headlineClaimIds:['claim-a']};
  const captioned=sample();captioned.captions=[{mediaId:'image-a',text:'A synthetic caption.',sourceIds:['source-a']}];
  for(const draft of [human,machine,assessed,captioned]) {
    const original=JSON.stringify(draft);
    assert.equal(draftHash(draft),legacyHash(draft),'No rehash or migration for known writer shapes');
    assert.equal(draftHash(reverseKeys(draft)),legacyHash(draft),'Nested reordering is not a content edit');
    assert.equal(JSON.stringify(draft),original,'Hashing never modifies the draft or its history');
  }
  assert.notEqual(legacyHash(human),legacyHash(reverseKeys(human)),'Old implementation reproduces false mismatch');
});

test('content, attestation, empty optional fields and array order still change integrity hashes', () => {
  const base=sample();const expected=draftHash(base);
  const changes:Array<(d:ArticleDraft)=>void>=[
    d=>{d.headline+=' changed';},d=>{d.body+=' changed';},d=>{d.sentences[0].text+=' changed';},
    d=>{d.sentences[0].claimIds.reverse();},d=>{d.sentences[0].humanReviewed=false;},
    d=>{d.factReview!.note+=' changed';},d=>{d.factReview!.reviewedAt='2026-09-14T00:00:00Z';},
    d=>{d.reviewRevision=2;},d=>{delete d.deck;},d=>{d.deck=' ';},d=>{d.access='public';},
    d=>{(d.factReview as unknown as Record<string,unknown>).unexpected='Do not ignore me';},
  ];
  for(const change of changes){const d=structuredClone(base);change(d);assert.notEqual(draftHash(d),expected);}
  assert.equal(canonicalJson({a:{b:2,c:3},list:[1,2]}),canonicalJson({list:[1,2],a:{c:3,b:2}}));
  assert.notEqual(canonicalJson({list:[1,2]}),canonicalJson({list:[2,1]}));
  assert.notEqual(canonicalJson({deck:''}),canonicalJson({}));
  assert.notEqual(canonicalJson({deck:null}),canonicalJson({deck:''}));
});

const quote='The trainer expects the young horse to improve with patient training.';
const source:SourceItem={id:'hash-test-source',title:'Synthetic racing trainer update',content:quote,
  sourceName:'Synthetic Racing Authority',url:'https://fixture.racing.test/trainer',type:'official',independenceKey:'synthetic-authority',
  publishedAt:'2026-09-12T00:00:00Z',retrievedAt:'2026-09-12T01:00:00Z'};
const question='Would owner background add colour to a longer synthetic profile?';
const provider:ResearchProvider={
  async research(){return {findings:[{text:quote,kind:'record_statement',sourceIds:[source.id],quote,confidence:'high',questions:[]}]};},
  async draft(request){const c=request.story.claims.find(c=>c.status==='verified')!;return {headline:'Synthetic trainer profile',sentences:[{text:c.text,claimIds:[c.id]}],researchRequests:[{agentId:1,question}]};},
};

// Normal CI supplies its own disposable PostgreSQL service; never connect these tests to Neon.
test('real jsonb store preserves legacy edited draft, delegated save/scope, backups and publication hashes', {skip:!process.env.HASH_TEST_DATABASE_URL}, async () => {
  const url=new URL(process.env.HASH_TEST_DATABASE_URL!);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Only the disposable loopback test database is allowed');
  assert.equal(url.pathname,'/hash_integrity_test','Refuse any other database');
  const names=['DATABASE_URL','AUTH_SECRET','ADMIN_PASSWORD','NEWSROOM_DELEGATED_DRAFT_REVIEW','NEWSROOM_DELEGATED_SCOPE_ASSESSMENT','VERCEL'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const sql=postgres(url.toString(),{max:1});
  try {
    delete process.env.VERCEL;process.env.DATABASE_URL=url.toString();
    process.env.AUTH_SECRET='synthetic-hash-test-secret-not-a-production-secret';
    process.env.ADMIN_PASSWORD='synthetic-hash-test-password-only';
    process.env.NEWSROOM_DELEGATED_DRAFT_REVIEW='true';process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT='true';
    const human=sample();human.hash=legacyHash(human);
    const [row]=await sql`select ${sql.json(human as never)}::jsonb as draft`;
    assert.notEqual(legacyHash(row.draft as ArticleDraft),human.hash,'Actual PostgreSQL reordering reproduces the original failure');
    assert.equal(draftHash(row.draft as ArticleDraft),human.hash,'Fix matches the original stored digest without rewriting it');

    const state=createState();await runNewsroom(state,{mode:'live',items:[source],maxRounds:1},provider);
    const story=state.stories[0],claimId=story.claims[0].id;
    editStoryDraft(state,story.id,{headline:'Synthetic trainer development',sentences:[{text:'The authority reports the trainer expects patient development.',claimIds:[claimId]}],note:'Synthetic owner review retained unchanged for regression.',humanReviewed:true,expectedDraftHash:story.draft!.hash,deck:''});
    const oldDraft=structuredClone(story.draft!);const oldDigest=oldDraft.hash;
    assert.equal(legacyHash(oldDraft),oldDigest);
    const fingerprint=evidenceFingerprint(state,story);
    await transact(data=>{data.state=structuredClone(state);delete data.lease;});
    let saved=(await readStore()).state;let current=saved.stories[0];
    assert.notEqual(legacyHash(current.draft!),oldDigest,'Real edit_draft output hit the old bug after store write');
    assert.equal(draftHash(current.draft!),oldDigest);
    assert.equal(evidenceFingerprint(saved,current),fingerprint);
    const cookie=`newsroom_session=${signSession()}`;
    const get=(query:string)=>GET(new Request(`https://hash-test.example/api/editorial?${query}`,{headers:{cookie}}));
    const post=(body:unknown)=>POST(new Request('https://hash-test.example/api/editorial',{method:'POST',headers:{cookie,origin:'https://hash-test.example','content-type':'application/json'},body:JSON.stringify(body)}));
    const bindings=await (await get(`action=assessed_draft&storyId=${story.id}`)).json();
    assert.equal(bindings.enabled,true);
    const content={headline:{text:'Trainer outlines patient development',evidence:[{sourceId:source.id,quote}]},paragraphs:[{text:'The racing authority reports that the trainer expects patient work to benefit the young horse.',evidence:[{sourceId:source.id,quote}]}],editorialTone:'N',note:'Synthetic assessor checked complete wording and source attribution for the PostgreSQL integration test.'};
    const response=await post({action:'assessed_draft',storyId:story.id,expectedDraftHash:bindings.expectedDraftHash,expectedEvidenceFingerprint:bindings.expectedEvidenceFingerprint,...content});
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    saved=(await readStore()).state;current=saved.stories[0];
    assert.ok(assessedDraftIntact(saved,current),'Delegated review survives jsonb, not just SQLite');
    assert.equal(current.draft!.factReview,undefined);
    assert.deepEqual(current.draftHistory!.find(d=>d.hash===oldDigest),oldDraft,'Original content, digest and personal attestation retained');
    const gap=current.gaps.find(g=>g.question===question)!;
    const scope=await (await get(`storyId=${story.id}&gapId=${gap.id}`)).json();
    assert.equal(scope.eligible,true,scope.refusal);
    const scoped=await post({action:'scope_assessment',storyId:story.id,gapId:gap.id,expectedDraftHash:scope.expectedDraftHash,expectedEvidenceFingerprint:scope.expectedEvidenceFingerprint,rationale:'Synthetic optional owner colour supports no assertion about the training expectations in this exact draft.',claimIds:current.draft!.sentences[0].claimIds});
    assert.equal(scoped.status,200,JSON.stringify(await scoped.clone().json()));
    saved=(await readStore()).state;current=saved.stories[0];
    assert.equal(current.status,'waiting_approval');assert.ok(assessedDraftIntact(saved,current));
    assert.ok(activeScopeAssessment(saved,current,current.gaps.find(g=>g.id===gap.id)!));
    assert.equal(saved.publications.length,0,'Saving and assessing never publish');
    const backup=parseBackup(await createBackup());const restored=backup.payload.store.state;const restoredStory=restored.stories[0];
    assert.ok(assessedDraftIntact(restored,restoredStory),'Schema parsing cannot invalidate a valid review');
    assert.ok(activeScopeAssessment(restored,restoredStory,restoredStory.gaps.find(g=>g.id===gap.id)!));
    assert.equal(draftHash(restoredStory.draftHistory!.find(d=>d.hash===oldDigest)!),oldDigest);
    const changed=structuredClone(saved);changed.stories[0].draft!.body+=' Unchecked addition.';
    const badBindings=assessedDraftContext(changed,story.id);
    assert.throws(()=>recordAssessedDraft(changed,story.id,{...content,expectedDraftHash:badBindings.expectedDraftHash,expectedEvidenceFingerprint:badBindings.expectedEvidenceFingerprint},true),/draft changed/i);
    const changedEvidence=structuredClone(saved);changedEvidence.sourceItems[0].content+=' Changed evidence.';
    assert.equal(assessedDraftIntact(changedEvidence,changedEvidence.stories[0]),false);
    await transact(data=>{decideStory(data.state,story.id,'approve','Synthetic publication, isolated loopback database only.',false);});
    const final=(await readStore()).state;
    assert.equal(draftHash(final.publications[0].draft),final.publications[0].draftHash);
    assert.equal(final.stories[0].draftHistory!.find(d=>d.hash===oldDigest)!.hash,oldDigest);
  } finally {
    await closeStore();await sql.end({timeout:2});
    for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  }
});
