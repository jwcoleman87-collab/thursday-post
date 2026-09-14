import { z } from 'zod';
import type { PeAgentId, ResearchAgentId, SourceItem } from './domain';

const ref = z.object({ sourceId: z.string().min(1).max(300), quote: z.string().min(12).max(280) }).strict();
const field = z.object({ text: z.string().min(1).max(1200), evidence: z.array(ref).min(1).max(4) }).strict();
export const AutonomousArticleSchema = z.object({
  headline: field, paragraphs: z.array(field).min(1).max(6), editorialTone: z.enum(['A','B','N']),
}).strict();
export type AutonomousArticle = z.infer<typeof AutonomousArticleSchema>;
export const AutonomousReviewSchema = z.object({
  fields: z.array(z.object({ index: z.number().int().min(0).max(6), supported: z.boolean(), complete: z.boolean(), reason: z.string().min(1).max(400) }).strict()).min(2).max(7),
  datesAppropriate: z.boolean(), editorialTone: z.enum(['A','B','N']),
  gaps: z.array(z.object({ gapId: z.string().min(1).max(300), outcome: z.enum(['optional','answered','needs_evidence','owner_required']), rationale: z.string().min(10).max(600), evidence: z.array(ref).max(4) }).strict()).max(12),
  research: z.array(z.object({ agentId: z.number().int().min(1).max(6), question: z.string().min(10).max(350) }).strict()).max(3),
  summary: z.string().min(20).max(900),
}).strict();
export type AutonomousReview = z.infer<typeof AutonomousReviewSchema>;
export interface AutonomousContext {
  storyId: string; title: string; issueDate: string; asOf: string;
  writerId: PeAgentId; reviewerId: PeAgentId;
  sources: Pick<SourceItem,'id'|'sourceName'|'url'|'type'|'publishedAt'|'publishedAtKnown'|'retrievedAt'|'content'>[];
  gaps: {id:string;question:string;agentId:ResearchAgentId;scopeEligible:boolean}[];
  feedback: string[];
}
export interface AutonomousProvider {
  composeArticle(input: AutonomousContext): Promise<AutonomousArticle>;
  reviewArticle(input: AutonomousContext & {article:AutonomousArticle}): Promise<AutonomousReview>;
}
export const AutonomousProgressSchema = z.object({
  phase: z.enum(['research','compose','review','ready','held']), issueDate:z.string(),
  basis:z.string(), draftBasis:z.string(), attempts:z.number().int().nonnegative(),
  retrievalBasis:z.string().optional(), feedback:z.array(z.string()).max(10),
  proposal:AutonomousArticleSchema.optional(), review:AutonomousReviewSchema.optional(),
  reviewerId:z.number().int().min(1).max(4), updatedAt:z.string(),
}).strict();
export type AutonomousProgress = z.infer<typeof AutonomousProgressSchema>;

/** Explicit edition context; a pre-event source must never silently become a result. */
export function nextIssueDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  const date=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+(4-date.getUTCDay()+7)%7);
  return date.toISOString().slice(0,10);
}
