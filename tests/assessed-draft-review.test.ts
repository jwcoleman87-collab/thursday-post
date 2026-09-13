import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,runNewsroom,assessedDraftContext,recordAssessedDraft,recordRightOfReply,recordScopeAssessment,scopeAssessmentContext,decideStory} from '../src/lib/engine';
import type {SourceItem,ResearchProvider,NewsroomState,Story} from '../src/lib/domain';
const quote='The racing authority confirmed the revised meeting date';
const angle='Contact stable staff for additional profile colour.';
const source:SourceItem={id:'review-original-source',title:'Authority meeting statement',content:quote+'.',url:'https://records.example.org/original-statement',sourceName:'Review fixture authority',type:'official',independenceKey:'review-fixture',publishedAt:'2026-09-11T00:00:00Z',retrievedAt:'2026-09-11T01:00:00Z'};
const provider:ResearchProvider={async research(){return {findings:[{text:quote,quote,sourceIds:[source.id],kind:'record_statement',confidence:'high'}]};},async draft({story}){return {headline:'Authority report',sentences:[{text:story.claims[0].text,claimIds:[story.claims[0].id]}],researchRequests:[{agentId:6,question:angle}]};}};
async function fixture(){const state=createState();await runNewsroom(state,{mode:'live',items:[source],maxRounds:1},provider);return {state,story:state.stories[0]};}
function input(state:NewsroomState,story:Story,sourceId=source.id){const {storyId:_id,...bindings}=assessedDraftContext(state,story.id);return {...bindings,editorialTone:story.editorialTone??"N",headline:{text:'Authority confirms its meeting timetable',evidence:[{sourceId,quote}]},paragraphs:[{text:'According to the racing authority, the revised date of the meeting has been confirmed.',evidence:[{sourceId,quote}]}],note:'The assessor checked this headline and paragraph against the selected archived authority statement. No result, ownership or additional factual assertion was added.'};}

test('invalidated reply is deleted from persisted story and cannot return after an identical second save',async()=>{
 const {state,story}=await fixture();story.editorialTone='B';
 recordRightOfReply(state,story.id,{status:'not_required',note:'Original personal reply assessment applies only to the original quotation briefing.',sourceIds:[],expectedDraftHash:story.draft!.hash});
 const originalReply=structuredClone(story.rightOfReply);
 assert.ok(originalReply);
 recordAssessedDraft(state,story.id,input(state,story),true);
 assert.equal(state.stories[0].rightOfReply,undefined,'The planned deletion must reach the actual stored story');
 assert.ok(state.audit.some(e=>e.action==='editorial.right_of_reply_invalidated'&&e.detail.includes(originalReply!.note)));
 // Retrying exactly the same article must not let the previous article's reply reappear.
 recordAssessedDraft(state,story.id,input(state,story),true);
 const gap=story.gaps.find(g=>g.question===angle)!;
 recordScopeAssessment(state,story.id,gap.id,{...scopeAssessmentContext(state,story.id,gap.id),rationale:'The article reports only a meeting-date statement and makes no assertion about stable staff.',claimIds:story.draft!.sentences.flatMap(s=>s.claimIds)},true);
 assert.equal(story.rightOfReply,undefined);assert.equal(story.status,'blocked');
 assert.equal(story.compliance.find(c=>c.gate==='publication')!.status,'blocked');
 assert.throws(()=>decideStory(state,story.id,'approve','Cannot reuse a stale reply.',false),/waiting for approval|blocked/);
 assert.equal(state.publications.length,0);
});

test('identical publisher wording links to the source actually selected, including later reassessment',async()=>{
 const {state,story}=await fixture();
 const newer={...source,id:'review-newer-source',url:'https://records.example.org/newer-statement'};
 const newest={...source,id:'review-newest-source',url:'https://records.example.org/newest-statement'};
 state.sourceItems.push(newer,newest);story.sourceItems.push(newer.id,newest.id);
 const priorId=story.claims[0].id;
 recordAssessedDraft(state,story.id,input(state,story,newer.id),true);
 const linked=story.draft!.sentences[0].claimIds;
 assert.ok(linked.every(id=>story.claims.find(c=>c.id===id)!.evidence.some(e=>e.sourceId===newer.id)),'Never silently substitute the earlier URL for a selected archive');
 assert.ok(!linked.includes(priorId));
 const previousIds=[...linked];
 recordAssessedDraft(state,story.id,input(state,story,newest.id),true);
 const selected=story.draft!.sentences[0].claimIds;
 assert.ok(selected.every(id=>story.claims.find(c=>c.id===id)!.evidence.some(e=>e.sourceId===newest.id)));
 assert.ok(selected.every(id=>!previousIds.includes(id)));
 assert.equal(state.publications.length,0);
});


test('replacement prose requires an explicit tone and cannot carry an old reply into newly adverse reporting',async()=>{
 const {state,story}=await fixture();
 recordRightOfReply(state,story.id,{status:'not_required',note:'The original neutral meeting-date notice required no subject response.',sourceIds:[],expectedDraftHash:story.draft!.hash});
 const good=input(state,story), {editorialTone:_tone,...missingTone}=good;
 const before=structuredClone(state);
 assert.throws(()=>recordAssessedDraft(state,story.id,missingTone,true));assert.deepEqual(state,before);
 recordAssessedDraft(state,story.id,{...good,editorialTone:'B'},true);
 assert.equal(story.editorialTone,'B');assert.equal(story.rightOfReply,undefined);
 const gap=story.gaps.find(g=>g.question===angle)!;
 recordScopeAssessment(state,story.id,gap.id,{...scopeAssessmentContext(state,story.id,gap.id),rationale:'The additional staff profile is unnecessary to support the archived authority statement.',claimIds:story.draft!.sentences.flatMap(s=>s.claimIds)},true);
 assert.equal(story.compliance.find(c=>c.gate==='publication')!.status,'blocked');
 assert.equal(story.status,'blocked');
 const adverse=structuredClone(state);
 assert.throws(()=>recordAssessedDraft(state,story.id,{...input(state,story),editorialTone:'N'},true),/cannot downgrade/);
 assert.deepEqual(state,adverse);assert.equal(state.publications.length,0);
});
