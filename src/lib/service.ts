import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { decideStory, runNewsroom } from './engine';
import { DEMO_ITEMS } from './fixtures';
import { collectSourceItems, createTargetedRetriever, type RegisteredSource, validateSourceUrl } from './ingestion';
import { createLiveProvider, liveProviderConfigured, GatewayAccessError } from './providers';
import { readStore, transact, type StoreData } from './store';
import { HttpError } from './auth';
import type { NewsroomState, SourceItem } from './domain';
import { WAGERING_POLICY } from './policy';
import { beginRunRecord, finishRunRecord } from './operations';

/** Trusted server dependencies permit isolated integration tests; HTTP actions never accept these fields. */
export interface RunServices { deadline?: number; collect?: typeof collectSourceItems; createProvider?: typeof createLiveProvider }
function boundedDeadline(requested?: number) {
  if (requested !== undefined && !Number.isFinite(requested)) throw new HttpError('Run deadline must be a finite timestamp.',400);
  const deadline = Math.min(Date.now()+270_000,requested??Infinity);
  if(deadline<=Date.now())throw new HttpError('The scheduler work budget has expired. Resume in a later invocation.',503);
  return deadline;
}
async function recoverExpiredRecord(id?:string) {
  if(!id)return;
  try{await finishRunRecord(id,{status:'interrupted'});}
  catch(error){if(!(error instanceof HttpError&&error.status===404))throw error;}
}

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
export async function collectSourcesOnly(services:RunServices={}){
  const deadline=boundedDeadline(services.deadline);
  const leaseId=randomUUID();
  const snapshot=await transact(data=>{
    assertIdle(data);const expiredLeaseId=data.lease?.id;
    if(expiredLeaseId)data.state.audit.push(event('run_recovered','An expired collection or research lease was recovered. Its prior run record is marked interrupted.'));
    data.lease={id:leaseId,expiresAt:new Date(Date.now()+3*60*1000).toISOString(),mode:'live'};
    const enabled=data.sources.filter(source=>source.enabled);const cursor=(data.sourceCursor||0)%Math.max(enabled.length,1);
    const selected=[...enabled.slice(cursor),...enabled.slice(0,cursor)].slice(0,2);
    data.sourceCursor=(cursor+selected.length)%Math.max(enabled.length,1);
    data.state.audit.push(event('collection_started','Source collection started. No model request or publication.'));return {sources:selected,expiredLeaseId};
  });
  let recorded=false;
  try{
    await recoverExpiredRecord(snapshot.expiredLeaseId);
    await beginRunRecord('collect',leaseId);recorded=true;
    const result=await(services.collect??collectSourceItems)({sources:snapshot.sources,maxSources:2,maxItemsPerSource:2,deadline:Math.min(deadline,Date.now()+90_000)});
    const added=await transact(data=>{
      if(data.lease?.id!==leaseId)throw new HttpError('Collection lease expired.',409);
      for(const item of result.items){
        if(item.demo||item.url.includes('example.invalid')||!item.id||!item.content||!item.sourceName||!item.independenceKey||!Number.isFinite(Date.parse(item.retrievedAt))||!Number.isFinite(Date.parse(item.publishedAt)))throw new HttpError('Collection returned an invalid or synthetic live source.',422);
        const existing=data.state.sourceItems.find(source=>source.id===item.id);
        if(existing&&(existing.content!==item.content||existing.url!==item.url))throw new HttpError('An archived source changed without a new revision identity.',409);
      }
      const fresh=[...new Map(result.items.filter(item=>!data.state.sourceItems.some(existing=>existing.id===item.id)).map(item=>[item.id,item])).values()];
      if(data.state.sourceItems.length+fresh.length>5000)throw new HttpError('Archive source records before collecting more than 5,000 items.',422);
      data.state.sourceItems.push(...fresh);
      for(const failure of result.errors)data.state.audit.push(event('source_fetch_failed',`${failure.sourceId}: ${failure.message}`));
      data.state.audit.push(event('collection_finished',`${fresh.length} new source records archived for research. AI and publication were not invoked.`));
      return fresh.length;
    });
    if(!result.items.length&&result.errors.length)throw new HttpError('No readable source records could be collected. Review source access and fetch errors in the audit.',422);
    await finishRunRecord(leaseId,{status:'completed',usage:[]});
    return {added,errors:result.errors.length};
  }catch(error){
    if(recorded)await finishRunRecord(leaseId,{status:'failed',error});
    await transact(data=>{if(data.lease?.id===leaseId)data.state.audit.push(event('collection_failed','Source collection did not complete. Review the source fetch audit; no model or publication was invoked.'));});
    throw error;
  }finally{await transact(data=>{if(data.lease?.id===leaseId)delete data.lease;});}
}
export async function startRun(mode:'demo'|'live',services:RunServices={}) {
  if(mode==='live' && process.env.NEWSROOM_AI_PAUSED==='true')throw new HttpError('Live AI is paused at James’s request. Complete AI Gateway account verification and enable live AI in deployment settings. Choose Demo mode to use the complete practice workflow.',503);
  if(mode==='live' && !liveProviderConfigured())throw new HttpError('Configure NEWSROOM_MODEL and either an AI Gateway API key or Vercel identity before starting live research.',503);
  const deadline=boundedDeadline(services.deadline);
  const leaseId=randomUUID();
  const acquired=await transact(data=>{
    assertIdle(data);
    const expiredLeaseId=data.lease?.id;
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
    return {snapshot,expiredLeaseId};
  });
  const snapshot=acquired.snapshot;
  const state=snapshot.state;
  let provider:ReturnType<typeof createLiveProvider>|undefined;
  let recorded=false;
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
    await recoverExpiredRecord(acquired.expiredLeaseId);
    await beginRunRecord(mode,leaseId);recorded=true;
    provider=mode==='live'?(services.createProvider??createLiveProvider)():undefined;
    await provider?.preflight();
    let items:SourceItem[];
    if(mode==='demo')items=[...structuredClone(DEMO_ITEMS),...snapshot.inbox.filter(item=>item.demo)];
    else {
      const result=await(services.collect??collectSourceItems)({sources:snapshot.sources,maxSources:2,maxItemsPerSource:2,deadline:Math.min(deadline,Date.now()+60_000)});
      for(const error of result.errors)state.audit.push(event('source_fetch_failed',`${error.sourceId}: ${error.message}`));
      const assignedIds=new Set(state.stories.flatMap(story=>story.sourceItems));
      const collectedBacklog=state.sourceItems.filter(item=>!item.demo&&!assignedIds.has(item.id));
      items=[...new Map([...result.items,...snapshot.inbox.filter(item=>!item.demo),...collectedBacklog].map(item=>[item.id,item])).values()];
      const hasPendingWork=state.stories.some(story=>story.mode==='live'&&['candidate','researching','drafting','sent_back','blocked'].includes(story.status));
      if(!items.length&&!hasPendingWork){
        state.audit.push(event('no_source_items','No usable live source items. Check enabled sources and the inbox.'));
        await checkpoint(state);
        throw new HttpError('No live items were available. Enable a source or import a reader email; inspect the audit log for fetch failures.',422);
      }
    }
    await checkpoint(state);
    const registry=mode==='live'?(await readStore()).sources:[];
    const previousAgentRuns=new Set(state.runs.map(run=>run.id));
    await runNewsroom(state,{mode,items,deadline},provider,checkpoint,mode==='live'?createTargetedRetriever(registry):undefined);
    state.audit.push(event('run_finished',`${mode} run finished. Ready stories await James; unresolved evidence remains labelled.`));
    await checkpoint(state);
    const failedTasks=state.runs.some(run=>!previousAgentRuns.has(run.id)&&run.status==='failed');
    await finishRunRecord(leaseId,{status:failedTasks?'failed':'completed',...(failedTasks?{error:new Error('Research or editorial task failure')}:{}),usage:provider?.usage});
  } catch(error) {
    if(recorded)await finishRunRecord(leaseId,{status:'failed',error,usage:provider?.usage});
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
  z.object({action:z.literal('collect')}),
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
  if(body.action==='collect'){await collectSourcesOnly();return;}
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
export async function publicPayload(options:{canReadPaid?:boolean}={}) {
  const {state}=await readStore();
  return {contactEmail:contactEmail(),memberAccess:Boolean(options.canReadPaid),articles:state.publications.filter(p=>p.public&&p.mode==='live'&&p.status!=='removed').sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,200).map(publication=>{
    const story=state.stories.find(s=>s.id===publication.storyId);
    const ids=new Set(story?.claims.filter(c=>publication.draft.sentences.some(s=>s.claimIds.includes(c.id))).flatMap(c=>c.evidence.map(e=>e.sourceId))||[]);
    const withdrawn=publication.status==='retracted';
    const locked=!withdrawn&&publication.access!=='public'&&!options.canReadPaid;
    const correction=state.publications.find(p=>p.correctionOf===publication.id&&p.public&&p.mode==='live'&&p.status!=='removed'&&p.status!=='retracted');
    const notice=publication.statusHistory?.at(-1)?.note||publication.correctionReason||(correction?'This report has a published correction. See Corrections & Updates.':undefined);
    return {id:publication.id,headline:publication.draft.headline,byline:publication.draft.byline,section:['Politics & Governance','Society & People','Business & Technology','Global Affairs'][publication.draft.peAgentId-1],publishedAt:publication.publishedAt,paragraphs:locked||withdrawn?[]:publication.draft.sentences.map(s=>({text:s.text,claimIds:s.claimIds})),sources:locked||withdrawn?[]:state.sourceItems.filter(source=>ids.has(source.id)&&source.type!=='email'&&source.url.startsWith('https://')).map(source=>({title:source.title,url:source.url})),limitations:locked||withdrawn?[]:publication.draft.limitations,excerpt:withdrawn?'':publication.draft.sentences[0]?.text.slice(0,180)||'',locked,status:publication.status||'published',notice,correctionOf:publication.correctionOf,correctionId:correction?.id,deck:withdrawn?undefined:publication.draft.deck,label:publication.draft.label};
  })};
}
