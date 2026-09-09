import policyFile from "../../config/wagering-policy.json";
import type { ComplianceCheck, Story } from "./domain";

export interface WageringPolicy {
  version: string;
  reviewedAt: string | null;
  expiresAt: string | null;
  reviewedBy: string | null;
  jurisdictions: string[];
  requireJamesAcknowledgement: boolean;
  allowOperatorPromotion: boolean;
  allowAffiliateLinks: boolean;
  allowInducements: boolean;
  blockedPhrases: string[];
  reviewNote: string;
}

export const WAGERING_POLICY: WageringPolicy = policyFile;

export function isWagering(text: string): boolean {
  return /\b(wager(?:ing)?|bett?ing|bookmaker|odds|punt(?:er|ing)?|each.way|selections?|bet|multibet|tipster)\b/i.test(text);
}

export function checkWagering(story: Story, policy: WageringPolicy = WAGERING_POLICY, now = new Date()): ComplianceCheck {
  const base = { id: `${story.id}-wagering`, gate: "wagering" as const, checkedAt: now.toISOString() };
  if (!story.wagering) return { ...base, status: "not_applicable", message: "No wagering material detected in this package." };
  const text = [story.title, story.draft?.headline, story.draft?.body, ...story.claims.map(c => c.text)].join(" ").toLowerCase();
  const reasons: string[] = [];
  const prohibited = policy.blockedPhrases.filter(phrase => text.includes(phrase.toLowerCase()));
  if (prohibited.length) reasons.push(`Prohibited winning or irresponsible wording: ${prohibited.join(", ")}`);
  if (/\b(children|kids|under.?18|schoolchildren|teenagers)\b/.test(text)) reasons.push("Material involving minors requires specific review");
  if (!policy.allowOperatorPromotion && /\b(sign up|join now|promo code|use code|recommended bookmaker|best bookmaker)\b/.test(text)) reasons.push("Operator promotion is disabled");
  if (!policy.allowAffiliateLinks && /\b(affiliate|commission|referral code)\b/.test(text)) reasons.push("Affiliate or commission content is disabled");
  if (!policy.allowInducements && /\b(bonus bet|free bet|deposit match|cashback|bet credit)\b/.test(text)) reasons.push("Inducements are disabled");
  const reviewed = policy.reviewedAt ? Date.parse(policy.reviewedAt) : NaN;
  const expiry = policy.expiresAt ? Date.parse(policy.expiresAt) : NaN;
  if (!Number.isFinite(reviewed) || !Number.isFinite(expiry) || reviewed > now.getTime() || expiry <= now.getTime() || expiry <= reviewed || !policy.reviewedBy || !policy.jurisdictions.length) {
    reasons.push("Current jurisdiction-specific wagering policy review is missing or expired");
  }
  if (reasons.length) return { ...base, status: "blocked", message: reasons.join(". ") + "." };
  return { ...base, status: "passed", message: `Policy ${policy.version} checked. James must explicitly acknowledge wagering review before publication; automated checks do not certify legal compliance.` };
}
