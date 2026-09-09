export interface EditionArticle {
  publicationId: string;
  storyId: string;
  draftHash: string;
  headline: string;
  byline: string;
  paragraphs: string[];
  sources: { title: string; url: string }[];
  limitations: string[];
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
