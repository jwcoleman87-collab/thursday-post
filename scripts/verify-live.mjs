import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
process.loadEnvFile('.env.local');
const base='https://the-racing-desk.vercel.app';
const anonymous=await fetch(`${base}/api/newsroom`);
assert.equal(anonymous.status,401,'Hosted operator API must reject anonymous requests');
const login=await fetch(`${base}/api/auth`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({password:process.env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(30000)});
assert.equal(login.status,200,'Owner sign-in must work');
const cookie=login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie,'Sign-in must issue a session cookie');
const response=await fetch(`${base}/api/newsroom`,{headers:{Cookie:cookie}});
assert.equal(response.status,200);
const initial=await response.json();
const publicResponse=await fetch(`${base}/api/public`);
assert.equal(publicResponse.status,200);
const publicBefore=await publicResponse.json();
assert.equal(publicBefore.contactEmail,'workbenchadmin@gmail.com');
assert.equal(initial.config.contactEmail,'workbenchadmin@gmail.com');
console.log('Hosted auth, persistent storage and public API passed. Public article count:',publicBefore.articles.length);
console.log('Readiness:',initial.config.readiness.map(item=>`${item.name}=${item.ready}`).join('; '));
if(process.argv.includes('--verify-launch')){
  assert.equal(initial.config.monitoring,false);
  assert.equal(initial.config.readiness.find(item=>item.name==='Live research').ready,false);
  const paused=await fetch(`${base}/api/newsroom`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'run',mode:'live'}),signal:AbortSignal.timeout(30000)});
  assert.equal(paused.status,503);
  assert.match((await paused.json()).error,/paused at James/);
  const demo=await fetch(`${base}/api/newsroom`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'run',mode:'demo'}),signal:AbortSignal.timeout(90000)});
  const result=await demo.json();
  assert.equal(demo.status,200,result.error);
  const waiting=result.state.stories.filter(story=>story.mode==='demo'&&story.status==='waiting_approval');
  assert.ok(waiting.length,'Hosted demo must finish with a reviewable draft');
  const after=await (await fetch(`${base}/api/public`)).json();
  assert.equal(after.articles.length,publicBefore.articles.length);
  const summary={testedAt:new Date().toISOString(),url:base,anonymousStatus:anonymous.status,loginStatus:login.status,publicStatus:publicResponse.status,contactEmail:after.contactEmail,liveAI:'paused by James; no model call',pausedGoStatus:paused.status,demoGoStatus:demo.status,demoDraftsAwaitingApproval:waiting.length,monitoring:false,publicArticles:after.articles.length,automaticEmail:'not connected'};
  writeFileSync('artifacts/launch-verification.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
}
if(process.argv.includes('--run-live')) {
  const run=await fetch(`${base}/api/newsroom`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},body:JSON.stringify({action:'run',mode:'live'}),signal:AbortSignal.timeout(300000)});
  const result=await run.json();
  assert.equal(run.status,200,result.error||'Live GO failed');
  const after=await (await fetch(`${base}/api/public`)).json();
  assert.equal(after.articles.length,publicBefore.articles.length,'GO must never publish');
  const summary={testedAt:new Date().toISOString(),url:base,anonymousStatus:anonymous.status,loginStatus:login.status,goStatus:run.status,stories:result.state.stories.map(story=>({id:story.id,status:story.status,mode:story.mode,claims:story.claims.length,verifiedClaims:story.claims.filter(claim=>claim.status==='verified').length,openGaps:story.gaps.filter(gap=>gap.status==='open').map(gap=>gap.question)})),publicArticles:after.articles.length,failures:result.state.audit.filter(entry=>entry.action.includes('failed')).map(entry=>({action:entry.action,detail:entry.detail}))};
  writeFileSync('artifacts/live-verification.json',JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));
}
