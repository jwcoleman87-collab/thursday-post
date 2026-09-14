from pathlib import Path
ROOT=Path('source')
def edit(path,old,new):
 p=ROOT/path;s=p.read_text();assert s.count(old)==1,(path,old[:90],s.count(old));p.write_text(s.replace(old,new))
edit('src/lib/engine.ts','function assessedDraftIntact(', 'export function assessedDraftIntact(')
edit('src/lib/autonomous.ts','addGap, verifiedClaim, activeScopeAssessment }','addGap, verifiedClaim, activeScopeAssessment, assessedDraftIntact }')
edit('src/lib/autonomous.ts','type AutonomousContext, type AutonomousProgress, type AutonomousProvider','type AutonomousContext, type AutonomousProgress, type AutonomousProvider, type AutonomousArticle')
helper='''/** A second gap-review batch must not regenerate the draft and invalidate the first batch. */
function sameAcceptedArticle(state:NewsroomState,story:Story,article:AutonomousArticle):boolean {
  const draft=story.draft;
  if(!draft||!assessedDraftIntact(state,story)||draft.headline!==article.headline.text||draft.sentences.length!==article.paragraphs.length||story.editorialTone!==article.editorialTone)return false;
  const referenceKey=(refs:{sourceId:string;quote:string}[])=>JSON.stringify([...new Set(refs.map(r=>JSON.stringify([r.sourceId,r.quote])))].sort());
  const storedReferences=(ids:string[])=>ids.flatMap(id=>(verifiedClaim(state,story,id)?.evidence??[]).filter(e=>e.exactMatch&&e.relation==='supports').map(e=>({sourceId:e.sourceId,quote:e.quote})));
  if(referenceKey(storedReferences(draft.assessorReview!.headlineClaimIds))!==referenceKey(article.headline.evidence))return false;
  return article.paragraphs.every((field,index)=>draft.sentences[index].text===field.text&&referenceKey(storedReferences(draft.sentences[index].claimIds))===referenceKey(field.evidence));
}

'''
edit('src/lib/autonomous.ts','async function timed<T>(',helper+'async function timed<T>(')
edit('src/lib/autonomous.ts',"    if(review.gaps.length!==new Set(review.gaps.map(g=>g.gapId)).size", "    if(review.gaps.length!==input.gaps.length||input.gaps.some(g=>!review.gaps.some(r=>r.gapId===g.id))||review.gaps.length!==new Set(review.gaps.map(g=>g.gapId)).size")
edit('src/lib/autonomous.ts',"Checker returned duplicate, unknown or unsupported gap decisions.","Checker must assess every supplied gap exactly once, using only supported references.")
edit('src/lib/autonomous.ts',"    const bindings=assessedDraftContext(planned,story.id);\n    recordAssessedDraft(planned,story.id,{expectedDraftHash:bindings.expectedDraftHash,expectedEvidenceFingerprint:bindings.expectedEvidenceFingerprint,...article,note:`Autonomous PE writer ${story.peAgentId}, independent checking PE ${p.reviewerId}; issue ${p.issueDate}. ${review.summary}`},true);", "    if(!sameAcceptedArticle(planned,candidate,article)){\n      const bindings=assessedDraftContext(planned,story.id);\n      recordAssessedDraft(planned,story.id,{expectedDraftHash:bindings.expectedDraftHash,expectedEvidenceFingerprint:bindings.expectedEvidenceFingerprint,...article,note:`Autonomous PE writer ${story.peAgentId}, independent checking PE ${p.reviewerId}; issue ${p.issueDate}. ${review.summary}`},true);\n    }")
p=ROOT/'tests/autonomous.test.ts';p.write_text(p.read_text()+'''

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
''')
print('Accepted draft identity preserved across complete independently checked gap batches.')
