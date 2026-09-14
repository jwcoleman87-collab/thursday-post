from pathlib import Path
ROOT=Path('source')
def replace(path,old,new):
 p=ROOT/path;s=p.read_text();assert s.count(old)==1,(path,s.count(old),old);p.write_text(s.replace(old,new))
replace('src/lib/engine.ts','function activeScopeAssessment(', 'export function activeScopeAssessment(')
replace('src/lib/autonomous.ts','addGap, verifiedClaim }','addGap, verifiedClaim, activeScopeAssessment }')
replace('src/lib/autonomous.ts',"const commission=(story:Story,agentId:number)=>story.researchAgentIds.includes(agentId as never);\nconst ownGap=(gap:Story['gaps'][number])=>gap.question.startsWith('James requests:');\n",'')
replace('src/lib/autonomous.ts',"g.blocking&&!g.scopeAssessment&&!operationalGap(state,story,g)","g.blocking&&!activeScopeAssessment(state,story,g)&&!operationalGap(state,story,g)")
replace('src/lib/autonomous.ts',"gaps:story.gaps.filter(g=>g.status==='open'&&g.blocking).slice(0,12)","gaps:story.gaps.filter(g=>g.status==='open'&&g.blocking&&!activeScopeAssessment(state,story,g)).slice(0,12)")
replace('src/lib/autonomous.ts',"    accepted.autonomy={...p,proposal:article,review,phase:accepted.status==='waiting_approval'?'ready':'held',basis:","    const remaining=accepted.gaps.filter(g=>g.status==='open'&&g.blocking&&!activeScopeAssessment(planned,accepted,g));\n    const batchCompleted=input.gaps.every(g=>!remaining.some(r=>r.id===g.id));\n    const nextPhase=accepted.status==='waiting_approval'?'ready':remaining.length&&batchCompleted?'review':'held';\n    accepted.autonomy={...p,proposal:article,review,phase:nextPhase,basis:")
replace('src/lib/providers.ts','      try {\n        this.dispatches++;','      try {\n        // Queued callers must recheck admission AFTER acquiring the shared permit.\n        if(this.dispatches >= (this.control.maxRequests??Infinity))throw new GatewayCapacityError();\n        if(Date.now()<this.rateLimitedUntil)throw new GatewayAccessError(429,"gateway_rate_limited");\n        this.dispatches++;')
p=ROOT/'tests/autonomous-provider.test.ts';p.write_text(p.read_text()+'''

test('queued parallel callers cannot overrun the shared autonomous dispatch allowance',async()=>{
 let requests=0;
 const provider=createLiveProvider({apiKey:'synthetic-unit-test',model:'openai/unit-test',maxRequests:2,transport:async()=>{requests++;await new Promise(r=>setTimeout(r,1));return response(article);}});
 const outcomes=await Promise.allSettled(Array.from({length:6},()=>provider.composeArticle!(context)));
 assert.equal(requests,2);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,2);
});
''')
p=ROOT/'tests/autonomous.test.ts';p.write_text(p.read_text()+'''

test('more optional questions than fit one checking pass drain across persisted PE reviews',async()=>{
 const state=createState(),log={research:[] as number[],writers:[] as number[],reviewers:[] as number[]};
 await runNewsroom(state,{...caps,items:items()},worker(log,20));
 for(let i=0;i<14;i++){const q=`Additional founder profile angle ${i}?`;addGap(state,state.stories[0],q,2,true,`editorial-${q}`);}
 for(let pass=0;pass<20&&state.stories[0].status!=='waiting_approval';pass++)await runNewsroom(state,{...caps,items:[]},worker(log,20));
 assert.equal(state.stories[0].status,'waiting_approval',JSON.stringify(state.stories[0].autonomy));
 assert.equal(state.stories[0].gaps.filter(g=>g.scopeAssessment).length,14);
 assert.equal(log.writers.length,1);assert.equal(log.reviewers.length,2);assert.equal(state.publications.length,0);
});
''')
print('Queue and review-batch hardening applied.')
