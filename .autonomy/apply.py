from pathlib import Path
import shutil
ROOT=Path('source')
def edit(path,old,new,count=1):
 p=ROOT/path;s=p.read_text();assert s.count(old)==count,(path,old[:90],s.count(old));p.write_text(s.replace(old,new))
for name in ['autonomous-contract.ts','autonomous.ts']:
 shutil.copyfile(Path('transfer/.autonomy')/name,ROOT/'src/lib'/name)
edit('src/lib/autonomous.ts','const bindings=assessedDraftContext(planned,story.id);\n    recordAssessedDraft(planned,story.id,{...bindings,storyId:undefined,...article,note:', 'const bindings=assessedDraftContext(planned,story.id);\n    recordAssessedDraft(planned,story.id,{expectedDraftHash:bindings.expectedDraftHash,expectedEvidenceFingerprint:bindings.expectedEvidenceFingerprint,...article,note:')
edit('src/lib/domain.ts','export interface Story {','export interface Story {\n  autonomy?: import("./autonomous-contract").AutonomousProgress;')
edit('src/lib/domain.ts','export interface NewsroomState {','export interface NewsroomState {\n  gatewayNotBefore?: number;')
# Public functions remain module helpers, not HTTP permissions. Existing engine selection stays authoritative.
for name in ['sourceItems','evidenceFingerprint','operationalGap','agentFollowupGap','resolveTask','addSource','audit','transition','addGap','verifiedClaim']:
 edit('src/lib/engine.ts',f'function {name}(',f'export function {name}(')
edit('src/lib/engine.ts','async function draftStory(','export async function draftStory(')
edit('src/lib/engine.ts','maxTaskRetries?: number }, provider?', 'maxTaskRetries?: number; autonomous?: boolean }, provider?')
edit('src/lib/engine.ts','  const deadline = Math.min(Date.now() + BUDGET.maxRunMs, input.deadline ?? Infinity);','  const autonomy = input.mode === "live" && input.autonomous ? await import("./autonomous") : undefined;\n  const deadline = Math.min(Date.now() + BUDGET.maxRunMs, input.deadline ?? Infinity);')
edit('src/lib/engine.ts','story.status === "blocked" && story.gaps.some(gap => gap.status === "open" && operationalGap(state, story, gap))','story.status === "blocked" && (autonomy ? autonomy.autonomousRetryable(state, story) : story.gaps.some(gap => gap.status === "open" && operationalGap(state, story, gap)))')
edit('src/lib/engine.ts','      const wasSentBack = story.status === "sent_back";', '      if (autonomy) await autonomy.prepareAutonomousResearch(state, story, retrieve, deadline, save);\n      const wasSentBack = story.status === "sent_back";')
edit('src/lib/engine.ts','      // Drafting may itself identify missing evidence; those requests share the same bounded loop.', '      if (autonomy) { await autonomy.finishAutonomousStory(state, story, researcher, deadline, save); continue; }\n      // Drafting may itself identify missing evidence; those requests share the same bounded loop.')
# Authorisation for unattended operation is a distinct server setting, not a model-supplied field.
edit('src/lib/service.ts',"  const deadline=boundedDeadline(services.deadline);\n  const leaseId=randomUUID();\n  const acquired=", "  const autonomous=mode==='live'&&process.env.NEWSROOM_AUTONOMOUS_AGENTS==='true';\n  const deadline=boundedDeadline(services.deadline);\n  const leaseId=randomUUID();\n  const acquired=")
edit('src/lib/service.ts','    assertIdle(data);\n    const expiredLeaseId=',"    assertIdle(data);\n    if(autonomous&&(data.state.gatewayNotBefore??0)>Date.now())throw new HttpError('The shared gateway cooldown is still active. The scheduled workflow will resume after '+new Date(data.state.gatewayNotBefore!).toISOString(),503);\n    const expiredLeaseId=")
edit('src/lib/service.ts',"provider=mode==='live'?(services.createProvider??createLiveProvider)():undefined;", "provider=mode==='live'?(services.createProvider??createLiveProvider)(autonomous?{maxRequests:4,onNotBefore:async until=>{state.gatewayNotBefore=Math.max(state.gatewayNotBefore??0,until);await checkpoint(state);}}:{}):undefined;")
edit('src/lib/service.ts','await runNewsroom(state,{mode,items,deadline,...', 'await runNewsroom(state,{mode,items,deadline,autonomous,...')
edit('src/lib/service.ts',"    {name:'Reader email',", "    {name:'Autonomous agents',ready:process.env.NEWSROOM_AUTONOMOUS_AGENTS==='true',detail:'Scheduled researchers, PE writer and a separate checking PE prepare source-linked articles; publication remains James’s decision.'},\n    {name:'Reader email',")
# Preserve across backup/restore; legacy backups omit the optional fields.
edit('src/lib/backup.ts',"import { z } from 'zod';", "import { z } from 'zod';\nimport { AutonomousProgressSchema } from './autonomous-contract';")
edit('src/lib/backup.ts','const storySchema = z.object({ id:', 'const storySchema = z.object({ autonomy: AutonomousProgressSchema.optional(), id:')
edit('src/lib/backup.ts','const stateSchema = z.object({ schemaVersion:', 'const stateSchema = z.object({ gatewayNotBefore:z.number().nonnegative().optional(), schemaVersion:')
# Readable private issue proof rather than a teaser-only success counter.
edit('src/components/next-issue-preview.tsx','<p className="paper-excerpt">{story.draft!.sentences[0]?.text}</p>', '<div className="paper-article-copy">{story.draft!.sentences.map((sentence,index)=><p key={index}>{sentence.text}</p>)}</div>')
# Provider contract: models only return bounded data. Shared per-run dispatch accounting includes preflight and retries.
edit('src/lib/providers.ts','import { z } from "zod";', 'import { z } from "zod";\nimport { AutonomousArticleSchema, AutonomousReviewSchema, type AutonomousContext, type AutonomousArticle } from "./autonomous-contract";')
edit('src/lib/providers.ts','const EDITORIAL_DISCIPLINES:', 'export const EDITORIAL_DISCIPLINES:')
edit('src/lib/providers.ts','class GatewayProvider implements ResearchProvider {','export class GatewayCapacityError extends Error { constructor(){super("Per-run model request allowance exhausted; the checkpoint will resume later.");this.name="GatewayCapacityError";} }\nexport interface GatewayControl { maxRequests?:number; onNotBefore?:(until:number)=>Promise<void> }\nclass GatewayProvider implements ResearchProvider {\n  private dispatches=0;')
edit('src/lib/providers.ts','private readonly transport: typeof fetch = fetch) {}','private readonly transport: typeof fetch = fetch, private readonly control: GatewayControl = {}) {}')
edit('src/lib/providers.ts','      await this.acquire();\n      try {','      if(this.dispatches >= (this.control.maxRequests??Infinity))throw new GatewayCapacityError();\n      await this.acquire();\n      try {\n        this.dispatches++;\n        await this.control.onNotBefore?.(Date.now()+(this.transport===fetch?GATEWAY_PACING.minIntervalMs:0));')
edit('src/lib/providers.ts','Math.min(GATEWAY_PACING.breakerMs, parseRetryAfter(response.headers.get("retry-after")) ?? GATEWAY_PACING.breakerMs)', 'Math.max(GATEWAY_PACING.breakerMs, parseRetryAfter(response.headers.get("retry-after")) ?? 0)')
edit('src/lib/providers.ts','Math.min(GATEWAY_PACING.breakerMs, declared ?? GATEWAY_PACING.breakerMs)', 'Math.max(GATEWAY_PACING.breakerMs, declared ?? 0)')
# All three terminal rate-limit paths persist their full cooldown, never a shortened provider wait.
edit('src/lib/providers.ts','        throw error;','        if(error instanceof GatewayAccessError&&error.status===429)await this.control.onNotBefore?.(this.rateLimitedUntil);\n        throw error;',3)
edit('src/lib/providers.ts','oidcTokenProvider?: () => Promise<string> } = {}','oidcTokenProvider?: () => Promise<string>; maxRequests?:number; onNotBefore?:(until:number)=>Promise<void> } = {}')
edit('src/lib/providers.ts','return new GatewayProvider(credential, model, options.transport);','return new GatewayProvider(credential, model, options.transport, options);')
methods=Path('transfer/.autonomy/provider-methods.txt').read_text()
edit('src/lib/providers.ts','  /** Run once before source collection or research fan-out; never sends newsroom material. */',methods+'\n  /** Run once before source collection or research fan-out; never sends newsroom material. */')
# Expose the methods structurally through the existing provider interface, not as tools.
edit('src/lib/domain.ts','export interface ResearchProvider {','export interface ResearchProvider {\n  composeArticle?: import("./autonomous-contract").AutonomousProvider["composeArticle"];\n  reviewArticle?: import("./autonomous-contract").AutonomousProvider["reviewArticle"];')
p=ROOT/'.env.example';p.write_text(p.read_text()+'\n# Unattended six-researcher/four-PE workflow; enable only after reviewed acceptance.\nNEWSROOM_AUTONOMOUS_AGENTS=false\n')
for name in ['autonomous.test.ts','autonomous-provider.test.ts']:
 shutil.copyfile(Path('transfer/.autonomy')/name,ROOT/'tests'/name)
shutil.copyfile('transfer/.autonomy/AUTONOMOUS_NEWSROOM.md',ROOT/'docs/AUTONOMOUS_NEWSROOM.md')
print('Autonomous research/editorial wiring applied; no production or story data changed.')
