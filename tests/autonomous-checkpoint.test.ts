import test from 'node:test';
import assert from 'node:assert/strict';
import {BUDGET,createState,runNewsroom} from '../src/lib/engine';
import type {NewsroomState,ResearchProvider,SourceItem} from '../src/lib/domain';

const quote='The racing authority reported that routine course maintenance was completed.';
const source:SourceItem={id:'checkpoint-record',title:'Horse racing course maintenance report',content:quote,url:'https://authority.test/report',sourceName:'Test Authority',type:'official',independenceKey:'test-authority',publishedAt:'2026-09-13T00:00:00Z',retrievedAt:'2026-09-13T01:00:00Z'};
const refs=[{sourceId:source.id,quote}];

test('request cap after writing survives serialisation and only the separate checking PE runs next time',async()=>{
  let state:NewsroomState=createState();
  const counts={research:0,writer:0,checker:0};
  const provider=():ResearchProvider=>{
    // Equivalent to four actual dispatches with preflight already consuming one.
    let calls=0;
    const admit=()=>{if(calls>=3){const error=new Error('Next bounded invocation required');error.name='GatewayCapacityError';throw error;}calls++;};
    return {
      async research(){admit();counts.research++;return {findings:[{text:quote,kind:'record_statement',quote,sourceIds:[source.id],contradictorySourceIds:[],questions:[],confidence:'high'}]};},
      async composeArticle(){admit();counts.writer++;return {headline:{text:'Authority reports maintenance completion',evidence:refs},paragraphs:[{text:'The authority said the routine work at the course had been completed.',evidence:refs}],editorialTone:'N'};},
      async reviewArticle(input){admit();counts.checker++;assert.notEqual(input.writerId,input.reviewerId);return {fields:[0,1].map(index=>({index,supported:true,complete:true,reason:'The attributed statement follows from the supplied exact record.'})),datesAppropriate:true,editorialTone:'N',gaps:[],research:[],summary:'A separate PE compared every field and the source dates with the supplied official record.'};},
    };
  };
  const options={mode:'live' as const,autonomous:true,maxRounds:BUDGET.maxLiveRounds,maxResearchTasks:BUDGET.maxLiveResearchTasks,maxTaskRetries:BUDGET.maxLiveRetries};
  await runNewsroom(state,{...options,items:[source]},provider());
  assert.deepEqual(counts,{research:2,writer:1,checker:0});
  assert.equal(state.stories[0].autonomy?.phase,'review');
  assert.equal(state.stories[0].status,'blocked');
  assert.equal(state.stories[0].draft?.assessorReview,undefined);
  const proposal=structuredClone(state.stories[0].autonomy!.proposal);
  state=JSON.parse(JSON.stringify(state)) as NewsroomState;
  await runNewsroom(state,{...options,items:[]},provider());
  assert.deepEqual(counts,{research:2,writer:1,checker:1});
  assert.deepEqual(state.stories[0].autonomy?.proposal,proposal);
  assert.equal(state.stories[0].status,'waiting_approval');
  assert.equal(state.stories[0].draft?.factReview,undefined);
  assert.equal(state.publications.length,0);
});
