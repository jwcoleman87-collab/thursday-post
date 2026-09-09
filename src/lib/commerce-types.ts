export type SubscriptionStatus = 'none' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused' | 'refunded' | 'payment_pending';

export interface Member {
  id: string;
  email: string;
  verifiedAt: string;
  createdAt: string;
  deliveryEnabled: boolean;
  consentAt: string | null;
  consentVersion: 'edition-email-v1';
  suppressedAt: string | null;
  suppressionReason: string | null;
  stripeCustomerId: string | null;
  subscription: {
    /** Missing on legacy records; canonical Stripe reconciliation must establish the mode before access. */
    stripeMode?: 'live' | 'test';
    id: string | null;
    status: SubscriptionStatus;
    paidThrough: string | null;
    cancelAtPeriodEnd: boolean;
    latestInvoiceId: string | null;
    reconciledAt: string | null;
  };
}

export interface CommerceSettings {
  liveSalesEnabled: boolean;
  priceId: string | null;
  approvedPriceIds: string[];
  monthlyAmount: number | null;
  currency: 'aud';
  priceLivemode: boolean | null;
  priceValidatedAt: string | null;
  updatedAt: string | null;
}

export interface CommerceData {
  version: 1;
  members: Record<string, Member>;
  links: Record<string, { email: string; expires: number; deliveryConsent: boolean }>;
  sessions: Record<string, { memberId: string; expires: number }>;
  attempts: Record<string, { count: number; until: number }>;
  settings: CommerceSettings;
  stripeEvents: Record<string, string>;
  leases: Record<string, { token: string; expires: number }>;
  checkoutSessions: Record<string, { id: string | null; priceId: string; expires: number; requestId: string }>;
}

export function initialCommerce(): CommerceData {
  return {
    version: 1, members: {}, links: {}, sessions: {}, attempts: {}, stripeEvents: {}, leases: {}, checkoutSessions: {},
    settings: { liveSalesEnabled: false, priceId: null, approvedPriceIds: [], monthlyAmount: null, currency: 'aud', priceLivemode: null, priceValidatedAt: null, updatedAt: null },
  };
}

export const COMMERCE_DOCUMENT = 'commerce-v1';

export interface CommerceReadiness {
  salesOpen: boolean;
  memberSignInReady: boolean;
  stripeConfigured: boolean;
  webhookConfigured: boolean;
  priceConfigured: boolean;
  liveSalesEnabled: boolean;
  monthlyAmount: number | null;
  currency: 'aud';
  mode: 'live' | 'test' | 'unconfigured';
  blockers: string[];
}
