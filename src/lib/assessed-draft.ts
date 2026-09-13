import { z } from 'zod';

// An operator supplies the actual archived passages they checked. These are source
// statements, not machine proof that a paraphrase follows logically from the evidence.
const reference = z.object({
  sourceId: z.string().min(1).max(300),
  quote: z.string().trim().min(12).max(700).refine(value => value.split(/\s+/).length <= 25,
    'Select an exact evidence passage of at most 25 words; do not truncate the article.'),
}).strict();
const field = (max: number) => z.object({
  text: z.string().trim().min(1).max(max),
  evidence: z.array(reference).min(1).max(8),
}).strict();
export const AssessedDraftInput = z.object({
  expectedDraftHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedEvidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  headline: field(160).refine(value => value.text.length >= 5),
  paragraphs: z.array(field(4000).refine(value => /[.!?][”"’']?$/.test(value.text),
    'Every paragraph must end as a complete sentence, not a clipped excerpt.')).min(1).max(20),
  note: z.string().trim().min(20).max(3000),
}).strict();
export type AssessedDraftInput = z.infer<typeof AssessedDraftInput>;
