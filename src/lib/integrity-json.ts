import type { ArticleDraft } from './domain';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function sorted(value: Json): Json {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  }
  return value;
}

/** JSON semantics, independent of object insertion order; arrays and string bytes are unchanged. */
export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('An integrity payload must be a JSON value.');
  return JSON.stringify(sorted(JSON.parse(json) as Json));
}

/**
 * Reconstruct the documented writer order, not PostgreSQL's internal ordering. Retaining
 * unknown keys prevents an unexpected nested property from silently disappearing from a hash.
 * No values, whitespace, empty strings, nulls or array positions are normalised away.
 */
function ordered(value: unknown, preferred: readonly string[]): unknown {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const keys = [...preferred.filter(key => Object.hasOwn(record, key)), ...Object.keys(record).filter(key => !preferred.includes(key)).sort()];
  return Object.fromEntries(keys.map(key => [key, record[key] === undefined ? undefined : sorted(JSON.parse(JSON.stringify(record[key])) as Json)]));
}

export type DraftHashFields = Pick<ArticleDraft, 'headline' | 'byline' | 'peAgentId' | 'sentences' | 'body' | 'limitations' | 'factReview' | 'assessorReview' | 'reviewRevision' | 'label' | 'deck' | 'dateline' | 'captions' | 'access'>;

/**
 * Preserve hashes produced by the existing draft writers while making nested key order
 * deterministic after jsonb persistence and backup parsing. This is NOT a new hash over
 * arbitrary content and never trusts, replaces or rewrites the stored draft.hash.
 * The top-level field list and nested field order match the original writer constructors.
 */
export function draftHashJson(draft: DraftHashFields): string {
  return JSON.stringify({
    headline: draft.headline,
    byline: draft.byline,
    peAgentId: draft.peAgentId,
    sentences: draft.sentences.map(sentence => ordered(sentence, ['text', 'claimIds', 'humanReviewed'])),
    body: draft.body,
    limitations: draft.limitations,
    factReview: ordered(draft.factReview, ['actor', 'note', 'reviewedAt']),
    reviewRevision: draft.reviewRevision,
    label: draft.label,
    deck: draft.deck,
    dateline: draft.dateline,
    captions: draft.captions?.map(caption => ordered(caption, ['mediaId', 'text', 'sourceIds'])),
    access: draft.access,
    assessorReview: ordered(draft.assessorReview, ['actor', 'authorisingOwner', 'note', 'reviewedAt', 'evidenceFingerprint', 'headlineClaimIds']),
  });
}
