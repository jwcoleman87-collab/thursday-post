import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, runNewsroom, recordAssessedDraft, assessedDraftContext, editStoryDraft, recordScopeAssessment, scopeAssessmentContext, decideStory, draftHash, projectScopeAssessments } from '../src/lib/engine';
import type { SourceItem, ResearchProvider, Story, NewsroomState } from '../src/lib/domain';

const quote = 'The racing authority recorded the revised meeting date';
const additional = 'The meeting is scheduled for 18 September 2026';
const third = 'The club announced a second inspection on Wednesday morning before racing';
const angle = 'Ask owners and stable staff for a more comprehensive profile.';
const source: SourceItem = { id: 'assessed-source-fixture', title: 'Racing authority fixture report',
  content: `${quote}. ${additional}. ${third}.`, url: 'https://records.example.org/assessed-draft-fixture',
  sourceName: 'Fixture racing authority', independenceKey: 'fixture-authority', type: 'official', region: 'QLD',
  publishedAt: '2026-09-11T00:00:00Z', retrievedAt: '2026-09-11T01:00:00Z' };
const provider: ResearchProvider = {
  async research() { return { findings: [{ text: quote, kind: 'record_statement', sourceIds: [source.id], quote, confidence: 'high' }] }; },
  async draft({story}) { return { headline: 'Fixture meeting', sentences: [{text:story.claims[0].text,claimIds:[story.claims[0].id]}], researchRequests:[{agentId:6,question:angle}] }; },
};
async function fixture() {
  const state = createState();
  await runNewsroom(state,{mode:'live',items:[structuredClone(source)],maxRounds:1},provider);
  const story=state.stories[0];
  return {state,story};
}
function input(state:NewsroomState,story:Story) {
  const {storyId:_id,...bindings}=assessedDraftContext(state,story.id);
  return {...bindings, editorialTone:story.editorialTone??"N", headline:{text:'Authority confirms revised fixture date',evidence:[{sourceId:source.id,quote}]},
    paragraphs:[{text:'According to the fixture authority, the revised meeting is scheduled for 18 September 2026.',evidence:[{sourceId:source.id,quote},{sourceId:source.id,quote:additional}]}],
    note:'The newsroom assessor checked the headline and full paragraph against the actual archived announcement, including the date and source attribution. No race result or ownership assertion was added.'};
}
function scope(state:NewsroomState,story:Story) {
  const gap=story.gaps.find(g=>g.question===angle)!;
  recordScopeAssessment(state,story.id,gap.id,{...scopeAssessmentContext(state,story.id,gap.id),
    rationale:'This article describes only the authority announcement. It asserts nothing about owners or stable staff, so their profile is outside this version.',
    claimIds:story.draft!.sentences.flatMap(s=>s.claimIds)},true);
}

test('complete assessed prose replaces a human-edited fragment without inventing a new James review, then reaches the tray after scope review',async()=>{
  const {state,story}=await fixture();
  editStoryDraft(state,story.id,{headline:story.draft!.headline,sentences:story.draft!.sentences,note:'Original personal fixture review.',humanReviewed:true,expectedDraftHash:story.draft!.hash});
  const previous=structuredClone(story.draft!);
  const oldAudit=structuredClone(state.audit);
  const draft=recordAssessedDraft(state,story.id,input(state,story),true);
  assert.equal(draft.factReview,undefined);
  assert.equal(draft.assessorReview?.actor,'newsroom-assessor');
  assert.equal(draft.assessorReview?.authorisingOwner,'James');
  assert.ok(draft.sentences.every(p=>!p.humanReviewed));
  assert.ok(story.draftHistory!.some(d=>JSON.stringify(d)===JSON.stringify(previous)));
  assert.deepEqual(state.audit.slice(0,oldAudit.length),oldAudit);
  assert.ok(state.audit.slice(oldAudit.length).every(e=>e.action!=='editorial.draft_edited'&&e.action!=='editorial.gap_resolved'));
  assert.equal(story.status,'blocked','saving prose does not silently clear an optional angle');
  assert.equal(draft.hash,draftHash(draft));
  scope(state,story);
  assert.equal(story.status,'waiting_approval');
  assert.equal(state.publications.length,0);
  assert.match(story.compliance.find(c=>c.gate==='evidence')!.message,/not James's personal/);
  const gap=story.gaps.find(g=>g.question===angle)!;
  assert.equal(gap.status,'open'); assert.equal(gap.resolution,undefined);
});

test('invalid authority, bindings, passages or paragraph endings fail atomically',async()=>{
  const {state,story}=await fixture(), good=input(state,story), before=structuredClone(state);
  assert.throws(()=>recordAssessedDraft(state,story.id,good,false),/not enabled/);
  for(const bad of [
    {...good,expectedDraftHash:'0'.repeat(64)}, {...good,expectedEvidenceFingerprint:'0'.repeat(64)},
    {...good,actor:'James'}, {...good,humanReviewed:true},
    {...good,paragraphs:[{text:'An invented claim.',evidence:[{sourceId:source.id,quote:'Invented passage absent from the source'}]}]},
    {...good,paragraphs:[{text:'A clipped fragment of the',evidence:good.paragraphs[0].evidence}]},
    {...good,headline:{...good.headline,evidence:[{sourceId:'foreign-source',quote}]}},
  ]) {assert.throws(()=>recordAssessedDraft(state,story.id,bad,true));assert.deepEqual(state,before);}
});

test('private, synthetic and nonmatching sources cannot supply a delegated draft',async()=>{
  for(const changes of [{type:'email' as const},{demo:true},{content:'No matching passage remains'}]) {
    const {state,story}=await fixture(); Object.assign(state.sourceItems[0],changes);
    const before=structuredClone(state);
    assert.throws(()=>recordAssessedDraft(state,story.id,input(state,story),true),/archived source|disputed or unverified/);
    assert.deepEqual(state,before);
  }
});

test('new exact passages are recorded whole with source-statement scope, never clipped into the article',async()=>{
  const {state,story}=await fixture();
  recordAssessedDraft(state,story.id,input(state,story),true);
  const added=story.claims.find(c=>c.evidence.some(e=>e.quote===additional))!;
  assert.ok(added);assert.equal(added.verificationScope,'source_statement');
  assert.ok(story.draft!.sentences[0].claimIds.includes(added.id));
  assert.ok(story.draft!.body.endsWith('.'));
  assert.equal(story.claims.find(c=>c.id===added.id)!.evidence[0].quote,additional);
});

test('existing quotation allowance still blocks excessive copying, without partial claims or draft writes',async()=>{
  const {state,story}=await fixture(), good=input(state,story), before=structuredClone(state);
  const bad={...good,paragraphs:[{text:source.content,evidence:[quote,additional,third].map(quote=>({sourceId:source.id,quote}))}]};
  assert.throws(()=>recordAssessedDraft(state,story.id,bad,true),/quotation allowance/);
  assert.deepEqual(state,before);
});

test('stale source contents or draft text invalidate the assessor review and publication',async()=>{
  for(const change of ['source','headline'] as const) {
    const {state,story}=await fixture();recordAssessedDraft(state,story.id,input(state,story),true);scope(state,story);
    if(change==='source') state.sourceItems[0].content+=' New contradictory context requires checking.';
    else story.draft!.headline+=' changed';
    const before=structuredClone(state), projected=projectScopeAssessments(state);
    assert.equal(projected.stories[0].status,'blocked'); assert.deepEqual(state,before);
    assert.throws(()=>decideStory(state,story.id,'approve','Test only',false),/changed|blocked/);
    assert.equal(state.publications.length,0);
  }
});

test('owner send-back, disputes, wagering and right-of-reply cannot be waived by a draft assessment',async()=>{
  const sent=await fixture();decideStory(sent.state,sent.story.id,'send_back','Please obtain the missing record.',false);
  assert.throws(()=>recordAssessedDraft(sent.state,sent.story.id,input(sent.state,sent.story),true),/send-back/);
  const disputed=await fixture();disputed.story.claims[0].status='disputed';
  assert.throws(()=>recordAssessedDraft(disputed.state,disputed.story.id,input(disputed.state,disputed.story),true),/contradictory/);
  for(const guard of ['wagering','reply'] as const) {
    const {state,story}=await fixture(); if(guard==='wagering')story.wagering=true;else story.editorialTone='B';
    recordAssessedDraft(state,story.id,input(state,story),true);scope(state,story);
    assert.equal(story.status,'blocked');assert.throws(()=>decideStory(state,story.id,'approve','Not authorised',true),/waiting for approval|blocked/);
    assert.equal(state.publications.length,0);
  }
});

test('a later personal edit removes delegated review only from the new version and invalidates its scope',async()=>{
  const {state,story}=await fixture();recordAssessedDraft(state,story.id,input(state,story),true);scope(state,story);
  const oldHash=story.draft!.hash;
  editStoryDraft(state,story.id,{headline:'Personally reviewed fixture report',sentences:story.draft!.sentences,note:'Personal fixture review of the current source.',humanReviewed:true,expectedDraftHash:oldHash});
  assert.equal(story.draft!.assessorReview,undefined);assert.equal(story.draft!.factReview!.actor,'James');
  assert.ok(story.draftHistory!.some(d=>d.hash===oldHash&&d.assessorReview));
  assert.equal(story.status,'blocked');
});
