import type { LicensedImage } from './domain';

export interface EditionArticle {
  publicationId: string;
  storyId: string;
  draftHash: string;
  headline: string;
  byline: string;
  paragraphs: string[];
  sources: { title: string; url: string }[];
  limitations: string[];
  /** Presentation fields, snapshotted with the article. Absent on editions made before layout existed. */
  section?: string;
  deck?: string;
  label?: string;
  publishedAt?: string;
  /** Only images whose licence and provenance passed the picture desk. */
  images?: LicensedImage[];
}

export type EditionBlockRole = 'lead' | 'secondary' | 'feature' | 'brief';
export interface EditionBlock {
  publicationId: string;
  role: EditionBlockRole;
  /** Index into the article's images; absent means the block uses its typographic treatment. */
  imageIndex?: number;
  /** A direct quotation already inside the approved text, set large. */
  pullQuote?: string;
  /** Front-page teaser: the opening only, jumping to the page where the story is printed in full. */
  teaser?: boolean;
  jumpTo?: number;
  /** Set on the full printing of a story that was teased on the front page. */
  continuedFrom?: number;
}
export type EditionPageTemplate = 'front' | 'picture-led' | 'text-led' | 'split' | 'features';
export interface EditionPage {
  number: number;
  section: string;
  template: EditionPageTemplate;
  blocks: EditionBlock[];
  words: number;
  substantial: boolean;
}

export interface NewspaperEdition {
  id: string;
  number: number;
  date: string;
  title: string;
  preview: string;
  status: 'draft' | 'released';
  articles: EditionArticle[];
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
  releasedBy?: 'James';
  reviewHash: string;
  /** Composed page plan. Absent on editions made before layout existed; readers fall back to a composed view. */
  pages?: EditionPage[];
}

export interface DeliveryJob {
  id: string;
  editionId: string;
  editionHash: string;
  memberId: string;
  email: string;
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'suppressed' | 'failed' | 'cancelled';
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  firstAttemptAt?: number;
  lease?: { id: string; until: number };
  providerId?: string;
  sentAt?: number;
  lastError?: string;
  /** Immutable body: provider idempotency also requires identical retry parameters. */
  payload?: { from: string; to: string[]; subject: string; html: string; text: string; reply_to: string; headers: Record<string, string>; tags: { name: string; value: string }[] };
}

export interface DeliveryStore {
  version: 1;
  jobs: DeliveryJob[];
  campaigns: { editionId: string; editionHash: string; queuedAt: number; queuedBy: 'James'; recipients: number }[];
  suppressions: Record<string, { reason: string; at: number }>;
  webhookIds: string[];
}
