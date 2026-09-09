import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
process.loadEnvFile('.env.local');
const base='https://the-racing-desk.vercel.app';
async function request(path,{body,cookie}={}){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:base}),...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(285000),redirect:'error'});}
const checks={};
for(const path of ['/api/newsroom','/api/owner/operations','/api/owner/editions','/api/owner/backup','/api/billing/settings']){const response=await request(path);assert.equal(response.status,401,`${path} must require its intended identity`);checks[path]=response.status;}
const anonymousMember=await request('/api/member');assert.equal(anonymousMember.status,200);assert.equal((await anonymousMember.json()).member,null);const anonymousCheckout=await request('/api/checkout',{body:{}});assert.equal(anonymousCheckout.status,401);checks['/api/checkout']=anonymousCheckout.status;
const login=await request('/api/auth',{body:{password:process.env.ADMIN_PASSWORD}});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
const read=async path=>{const r=await request(path,{cookie});assert.equal(r.status,200,path);return r.json();};
const before=await(await request('/api/public')).json();assert.equal(before.contactEmail,'workbenchadmin@gmail.com');
const offer=await(await request('/api/billing/offer')).json();assert.equal(offer.liveSalesEnabled,false);
const billing=await read('/api/billing/settings');assert.equal(billing.settings.liveSalesEnabled,false);
const paused=await request('/api/newsroom',{cookie,body:{action:'run',mode:'live'}});assert.equal(paused.status,503);assert.match((await paused.json()).error,/paused at James/);
const demo=await request('/api/newsroom',{cookie,body:{action:'run',mode:'demo'}});assert.equal(demo.status,200);const demoData=await demo.json();assert.ok(demoData.state.stories.some(s=>s.mode==='demo'&&s.status==='waiting_approval'));
let collected=null;
if(process.argv.includes('--collect')){const collect=await request('/api/newsroom',{cookie,body:{action:'collect'}});const data=await collect.json();assert.equal(collect.status,200,data.error);collected={status:collect.status,archivedSources:data.state.sourceItems.filter(s=>!s.demo).length};}
const after=await(await request('/api/public')).json();assert.equal(after.articles.length,before.articles.length);
const newsroom=await read('/api/newsroom');assert.equal(newsroom.config.running,false);assert.equal(newsroom.config.monitoring,false);
const health=await read('/api/owner/operations');const editions=await read('/api/owner/editions');
const summary={testedAt:new Date().toISOString(),url:base,anonymousChecks:checks,ownerLogin:login.status,publicArticles:after.articles.length,liveSalesEnabled:offer.liveSalesEnabled,liveAI:'paused',liveGoStatus:paused.status,demoGoStatus:demo.status,collection:collected,monitoring:newsroom.config.monitoring,running:newsroom.config.running,runRecords:health.totals,editionCount:editions.editions.length,deliveryConfigured:editions.delivery.configured,checkoutMode:billing.readiness.mode,memberEmailConfigured:billing.readiness.memberSignInReady,providerCalls:'No Stripe transaction, model request or outbound email sent'};
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/overnight-live-verification.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
