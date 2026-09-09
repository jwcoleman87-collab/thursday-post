import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { decideStory, runNewsroom } from './engine';
import { DEMO_ITEMS } from './fixtures';
import { collectSourceItems, type RegisteredSource, validateSourceUrl } from './ingestion';
import { createLiveProvider, liveProviderConfigured, GatewayAccessError } from './providers';
import { readStore, transact, type StoreData } from './store';
import { HttpError } from './auth';
import type { NewsroomState, SourceItem } from './domain';
import { WAGERING_POLICY } from './policy';

export const contactEmail=()=>process.env.NEWSROOM_CONTACT_EMAIL || 'workbenchadmin@gmail.com';
const active=(data:StoreData)=>Boolean(data.lease && Date.parse(data.lease.expiresAt)>Date.now());
const event=(action:string,detail:string)=>({id:randomUUID(),action,detail,createdAt:new Date().toISOString()});
export function readiness(data:StoreData) {
  return [
    {name:'Evidence storage',ready:Boolean(process.env.DATABASE_URL)||!process.env.VERCEL,detail:process.env.DATABASE_URL?'Persistent Postgres':'Persistent SQLite on this computer'},
    {name:'James’s sign-in',ready:Boolean(process.env.AUTH_SECRET && process.env.ADMIN_PASSWORD),detail:process.env.VERCEL?'Password and signed session required':'Local demo access; password required when hosted'},
    {name:'Live research',ready:process.env.NEWSROOM_AI_PAUSED!=='true' && liveProviderConfigured(),detail:process.env.NEWSROOM_AI_PAUSED==='true'?'Live AI is paused at James’s request. Complete Vercel AI Gateway account verification, then set NEWSROOM_AI_PAUSED=false and redeploy. Demo mode remains available.':'Selected model with API key or Vercel identity; available model access and credits are checked when a run starts'},
    {name:'Racing sources',ready:data.sources.some(source=>source.enabled),detail:`${data.sources.filter(source=>source.enabled).length} sources enabled; access and fetch errors are logged`},
    {name:'Reader email',ready:Boolean(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET && process.env.NEWSROOM_INBOUND_ADDRESS),detail:'Signed inbound webhook for a dedicated receiving address; Gmail forwarding is a separate mailbox setup. Private .eml import is available.'},
    {name:'Monitoring',ready:data.monitoring,detail:'One daily Vercel run when enabled; local GO works at any time'},
    {name:'Wagering legal review',ready:Boolean(WAGERING_POLICY.reviewedAt && WAGERING_POLICY.reviewedBy && WAGERING_POLICY.expiresAt && Date.parse(WAGERING_POLICY.expiresAt)>Date.now()),detail:'Dated jurisdiction policy is checked again at publication; James must explicitly acknowledge wagering review'}
  ];
}
export async function newsroomPayload() {
  const data=await readStore();
  const state=structuredClone(data.state);
  // Inbox entries are visible immediately, including while an autonomous run holds its lease.
  for(const item of data.inbox)if(!state.sourceItems.some(source=>source.id===item.id))state.sourceItems.push(item);
  // Originals remain durable and individually downloadable; never copy attachment-sized payloads into every dashboard response.
  state.sourceItems=state.sourceItems.map(item=>({...item,rawOriginal:undefined,email:item.email?{...item.email,original:''}:undefined}));
  return {state,config:{mode:process.env.NEWSROOM_MODE==='live'?'live':'demo',contactEmail:contactEmail(),running:active(data),monitoring:data.monitoring,readiness:readiness(data),sources:data.sources.map(source=>({id:source.id,name:source.name,url:source.url,type:source.type,adapter:source.format,jurisdiction:source.region,enabled:source.enabled,notes:source.notes}))}};
}
function assertIdle(data:StoreData) {if(active(data))throw new HttpError('A newsroom run is in progress. Wait for the approval package.',409);}
export async function startRun(mode:'demo'|'live') {
  if(mode==='live' && process.env.NEWSROOM_AI_PAUSED==='true')throw new HttpError('Live AI is paused at James’s request. Complete AI Gateway account verification and enable live AI in deployment settings. Choose Demo mode to use the complete practice workflow.',503);
  if(mode==='live' && !liveProviderConfigured())throw new HttpError('Configure NEWSROOM_MODEL and either an AI Gateway API key or Vercel identity before starting live research.',503);
  const leaseId=randomUUID();
  const snapshot=await transact(data=>{
    assertIdle(data);
    if(data.lease)data.state.audit.push(event('run_recovered','An interrupted run lease expired. Checkpointed evidence was retained; unresolved work is retried.'));
    data.lease={id:leaseId,expiresAt:new Date(Date.now()+8*60*1000).toISOString(),mode};
    data.state.audit.push(event('run_started',`${mode} run started. Publication always requires James’s decision.`));
    const snapshot=structuredClone(data);
    if(mode==='live') {
      const enabled=data.sources.filter(source=>source.enabled);
      const cursor=(data.sourceCursor||0)%Math.max(enabled.length,1);
      snapshot.sources=[...enabled.slice(cursor),...enabled.slice(0,cursor)].slice(0,2);
      data.sourceCursor=(cursor+snapshot.sources.length)%Math.max(enabled.length,1);
    }
    return snapshot;
  });
  let state=snapshot.state;
  const checkpoint=async(next:NewsroomState)=>{
    await transact(data=>{
      if(data.lease?.id!==leaseId)throw new HttpError('This run’s lease is no longer active.',409);
      const saved=structuredClone(next);
      const seen=new Set(saved.audit.map(entry=>entry.id));
      saved.audit.push(...data.state.audit.filter(entry=>!seen.has(entry.id)));
      saved.audit.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      data.state=saved;
    });
  };
  try {
    const provider=mode==='live'?createLiveProvider():undefined;
    await provider?.preflight();
    let items:SourceItem[];
    if(mode==='demo')items=[...structuredClone(DEMO_ITEMS),...snapshot.inbox.filter(item=>item.demo)];
    else {
      const result=await collectSourceItems({sources:snapshot.sources,maxSources:2,maxItemsPerSource:2});
      for(const error of result.errors)state.audit.push(event('source_fetch_failed',`${error.sourceId}: ${error.message}`));
      items=[...result.items,...snapshot.inbox.filter(item=>!item.demo)];
      if(!items.length){
        state.audit.push(event('no_source_items','No usable live source items. Check enabled sources and the inbox.'));
        await checkpoint(state);
        throw new HttpError('No live items were available. Enable a source or import a reader email; inspect the audit log for fetch failures.',422);
      }
    }
    await checkpoint(state);
    await runNewsroom(state,{mode,items},provider,checkpoint);
    state.audit.push(event('run_finished',`${mode} run finished. Ready stories await James; unresolved evidence remains labelled.`));
    await checkpoint(state);
  } catch(error) {
    const failure=error instanceof GatewayAccessError?new HttpError(error.message,503):error;
    state.audit.push(event('run_failed',failure instanceof HttpError?failure.message:'A provider or workflow operation failed. Evidence from completed checkpoints is retained.'));
    await checkpoint(state);
    throw failure;
  } finally {
    await transact(data=>{if(data.lease?.id===leaseId)delete data.lease;});
  }
}

const sourceInput=z.object({name:z.string().trim().min(2).max(100),url:z.url().max(2048),type:z.enum(['official','publication','email','social','media','data']),adapter:z.enum(['rss','html']),articlePathPrefix:z.string().startsWith('/').max(300).optional(),jurisdiction:z.string().max(80).default('Australia'),enabled:z.boolean().default(false)});
export const ActionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('run'),mode:z.enum(['demo','live'])}),
  z.object({action:z.literal('decision'),storyId:z.string().min(1),decision:z.enum(['approve','reject','send_back']),note:z.string().max(3000).default(''),wageringAcknowledged:z.boolean().default(false),expectedDraftHash:z.string().optional()}),
  z.object({action:z.literal('source'),source:sourceInput}),
  z.object({action:z.literal('source_toggle'),sourceId:z.string(),enabled:z.boolean()}),
  z.object({action:z.literal('monitoring'),enabled:z.boolean()})
]);
export async function handleAction(input:unknown) {
  const parsed=ActionSchema.safeParse(input);
  if(!parsed.success)throw new HttpError('Check the action fields and try again.',400);
  const body=parsed.data;
  if(body.action==='run'){await startRun(body.mode);return;}
  await transact(data=>{
    if(body.action==='decision'){
      assertIdle(data);
      if(body.decision==='approve' && (!body.expectedDraftHash || data.state.stories.find(story=>story.id===body.storyId)?.draft?.hash!==body.expectedDraftHash))throw new HttpError('The draft has changed or its review fingerprint is missing. Reload and review the current package.',409);
      if(body.decision==='send_back'&&!body.note.trim())throw new HttpError('Describe the exact change or evidence needed before sending a story back.',400);
      try {decideStory(data.state,body.storyId,body.decision,body.note,body.wageringAcknowledged);}
      catch(error){throw new HttpError(error instanceof Error?error.message:'This decision is unavailable.',409);}
    } else if(body.action==='source') {
      if(data.sources.length>=30)throw new HttpError('This lean release supports up to 30 registered sources.',422);
      const host=new URL(body.source.url).hostname;
      validateSourceUrl(body.source.url,[host]);
      if(data.sources.some(source=>source.url===body.source.url))throw new HttpError('That source URL is already registered.',409);
      const source:RegisteredSource={id:randomUUID(),name:body.source.name,url:body.source.url,allowedHosts:[host],format:body.source.adapter,type:body.source.type,region:body.source.jurisdiction,enabled:body.source.enabled,termsReviewedAt:body.source.enabled?new Date().toISOString():undefined,notes:'Owner-registered source. Fetching observes robots restrictions; availability is checked during each run.'};
      if(source.format==='html')source.articlePathPrefix=body.source.articlePathPrefix || new URL(source.url).pathname.replace(/\/+$/,'')+'/';
      data.sources.push(source);
      data.state.audit.push(event('source_registered',source.name));
    } else if(body.action==='source_toggle') {
      const source=data.sources.find(source=>source.id===body.sourceId);
      if(!source)throw new HttpError('Source not found.',404);
      source.enabled=body.enabled;
      if(body.enabled)source.termsReviewedAt=new Date().toISOString();
      data.state.audit.push(event('source_updated',`${source.name}: ${body.enabled?'enabled':'disabled'}`));
    } else {
      data.monitoring=body.enabled;
      data.state.audit.push(event('monitoring_updated',body.enabled?'Daily source monitoring enabled. No automatic publication.':'Source monitoring paused.'));
    }
  });
}
export async function ingestEmail(item:SourceItem) {
  return await transact(data=>{
    if(data.inbox.some(existing=>existing.id===item.id || existing.email?.messageId===item.email?.messageId))return false;
    if(data.inbox.length>=1000)throw new HttpError('Inbox storage limit reached. Export and archive before importing more.',422);
    data.inbox.push(item);
    data.state.audit.push(event(item.isCorrection?'correction_received':'email_received',`Private reader lead ${item.id} retained for verification.`));
    return true;
  });
}
export async function publicPayload() {
  const {state}=await readStore();
  return {contactEmail:contactEmail(),articles:state.publications.filter(p=>p.public&&p.mode==='live').map(publication=>{
    const story=state.stories.find(s=>s.id===publication.storyId);
    const ids=new Set(story?.claims.filter(c=>publication.draft.sentences.some(s=>s.claimIds.includes(c.id))).flatMap(c=>c.evidence.map(e=>e.sourceId))||[]);
    return {id:publication.id,headline:publication.draft.headline,byline:publication.draft.byline,section:['Politics & Governance','Society & People','Business & Technology','Global Affairs'][publication.draft.peAgentId-1],publishedAt:publication.publishedAt,paragraphs:publication.draft.sentences.map(s=>({text:s.text,claimIds:s.claimIds})),sources:state.sourceItems.filter(source=>ids.has(source.id)&&source.type!=='email'&&source.url.startsWith('https://')).map(source=>({title:source.title,url:source.url})),limitations:publication.draft.limitations};
  })};
}
