export type Mode = "demo" | "live";
export type ResearchAgentId = 1 | 2 | 3 | 4 | 5 | 6;
export type PeAgentId = 1 | 2 | 3 | 4;
export type Confidence = "low" | "medium" | "high";
export type SourceType = "official" | "publication" | "email" | "social" | "media" | "data";
export type StoryStatus = "candidate" | "researching" | "drafting" | "waiting_approval" | "blocked" | "published" | "rejected" | "sent_back";
export type ClaimKind = "record_statement" | "fact" | "opinion" | "inference" | "allegation";

export const RESEARCH_AGENTS = [
  { id: 1, name: "Open Source Monitoring", description: "Discover public information and preserve provenance; repetition is not corroboration." },
  { id: 2, name: "Official Records & Data", description: "Examine primary records and distinguish record contents from proven facts." },
  { id: 3, name: "Expert Sources & Analysis", description: "Assess expertise, conflicts, opinion and technical interpretation." },
  { id: 4, name: "Social Media & Eyewitnesses", description: "Assess authenticity, independence, timing and first-hand knowledge." },
  { id: 5, name: "Imagery & Media Verification", description: "Check provenance, context, reuse, manipulation and caption support." },
  { id: 6, name: "Geopolitical & Regional Focus", description: "Preserve jurisdictional and regional context." },
] as const;

export const PE_AGENTS = [
  { id: 1, name: "Politics & Governance", description: "Calm, evidence-led reporting on racing governance and policy." },
  { id: 2, name: "Society & People", description: "Humane reporting on participants and racing communities." },
  { id: 3, name: "Business & Technology", description: "Evidence-led reporting on racing businesses, bloodstock and technology." },
  { id: 4, name: "Global Affairs", description: "International racing with regional and regulatory context." },
] as const;

export interface MediaAsset {
  id: string;
  url: string;
  sourceId: string;
  earliestSource: string | null;
  proposedCaption: string;
  context: "verified" | "unknown" | "contradicted";
  date: string | null;
  location: string | null;
  manipulation: "not_detected" | "detected" | "unknown";
  aiStatus: "generated" | "modified" | "no_evidence" | "unknown";
  reuseHistory: string[];
  captionSupported: boolean;
  rights: "cleared" | "unknown";
  allowed: boolean;
}

export interface SourceItem {
  id: string;
  title: string;
  content: string;
  url: string;
  type: SourceType;
  sourceName: string;
  independenceKey: string;
  publishedAt: string;
  retrievedAt: string;
  rawOriginal?: string;
  publishedAtKnown?: boolean;
  region?: string;
  topics?: string[];
  isCorrection?: boolean;
  relatedStoryId?: string;
  email?: { messageId: string; from: string; subject: string; receivedAt: string; original: string; headers?: { key: string; line: string }[]; attachments?: { filename: string; contentType: string; size: number; checksum?: string }[]; originalEncoding?: "utf8" | "base64" };
  media?: MediaAsset[];
  /** Only local synthetic fixtures set this. Live mode always rejects fixture sources. */
  demo?: boolean;
}

export interface FindingInput {
  text: string;
  kind: ClaimKind;
  sourceIds: string[];
  quote?: string;
  contradictorySourceIds?: string[];
  questions?: string[];
  confidence: Confidence;
}

export interface Evidence {
  id: string;
  sourceId: string;
  quote: string;
  relation: "supports" | "contradicts";
  exactMatch: boolean;
  independenceKey: string;
  recordedAt: string;
}

export interface Claim {
  id: string;
  text: string;
  kind: ClaimKind;
  agentId: ResearchAgentId;
  evidence: Evidence[];
  status: "verified" | "unverified" | "disputed";
  verificationScope: "source_statement" | "underlying_fact" | "unverified";
  confidence: Confidence;
  questions: string[];
  createdAt: string;
}

export interface ResearchFinding {
  id: string;
  storyId: string;
  taskId: string;
  agentId: ResearchAgentId;
  claimIds: string[];
  summary: string;
  createdAt: string;
}

/**
 * A delegated assessment that an additional reporting angle is not required for the scope of
 * the draft as written. It is explicitly NOT a finding that missing evidence was verified, and
 * NOT a human review of the claims: the automated assessor and the authorising owner are
 * recorded separately. It is bound to the exact draft and evidence it was made against, so any
 * change to the reporting forces a fresh assessment.
 */
export interface ScopeAssessment {
  outcome: "not_required_for_scope";
  rationale: string;
  assessor: "newsroom-assessor";
  authorisingOwner: "James";
  claimIds: string[];
  draftHash: string;
  evidenceFingerprint: string;
  assessedAt: string;
}

export interface EvidenceGap {
  id: string;
  question: string;
  agentId: ResearchAgentId;
  status: "open" | "resolved";
  blocking: boolean;
  resolution?: string;
  scopeAssessment?: ScopeAssessment;
  claimIds: string[];
  createdAt: string;
}

export interface ArticleSentence { text: string; claimIds: string[]; humanReviewed?: boolean }
export interface ArticleDraft {
  id: string;
  headline: string;
  byline: string;
  peAgentId: PeAgentId;
  sentences: ArticleSentence[];
  body: string;
  hash: string;
  createdAt: string;
  limitations: string[];
  /** Human review is an editorial attestation, never automatic proof of a source's assertion. */
  factReview?: { actor: "James"; note: string; reviewedAt: string };
  /** Delegated editorial judgement, never a personal fact attestation by James. */
  assessorReview?: { actor: "newsroom-assessor"; authorisingOwner: "James"; note: string; reviewedAt: string; evidenceFingerprint: string; headlineClaimIds: string[] };
  reviewRevision?: number;
  label?: "opinion" | "analysis" | "update" | "correction" | "right_of_reply";
  deck?: string;
  dateline?: string;
  captions?: { mediaId: string; text: string; sourceIds: string[] }[];
  access?: "public" | "members";
}

export interface ComplianceCheck {
  id: string;
  gate: "evidence" | "imagery" | "wagering" | "publication";
  status: "passed" | "blocked" | "warning" | "not_applicable";
  message: string;
  checkedAt: string;
}

export interface Approval {
  id: string;
  decision: "approve" | "reject" | "send_back";
  note: string;
  actor: "James";
  draftHash: string | null;
  wageringAcknowledged: boolean;
  createdAt: string;
}

export interface Story {
  autonomy?: import("./autonomous-contract").AutonomousProgress;
  id: string;
  title: string;
  summary: string;
  mode: Mode;
  status: StoryStatus;
  selectedReason: string;
  researchAgentIds: ResearchAgentId[];
  peAgentId: PeAgentId;
  sourceItems: string[];
  claims: Claim[];
  findings: ResearchFinding[];
  gaps: EvidenceGap[];
  media: MediaAsset[];
  draft?: ArticleDraft;
  draftHistory?: ArticleDraft[];
  proposedDraft?: DraftResult & { createdAt: string; status: "requires_human_review" };
  compliance: ComplianceCheck[];
  approvals: Approval[];
  wagering: boolean;
  correctionOf?: string;
  correctionReason?: string;
  access?: "public" | "members";
  publishedEvidenceAlerts?: { sourceIds: string[]; receivedAt: string; status: "open" | "reviewed" }[];
  /** Internal editorial assessment only. Never expose this in the reader payload. */
  editorialTone?: "A" | "B" | "N";
  rightOfReply?: { status: "not_required" | "requested" | "received" | "declined" | "no_response"; note: string; recipient?: string; requestedAt?: string; deadline?: string; sourceIds: string[]; recordedAt: string; actor: "James" };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchTask {
  id: string;
  storyId: string;
  agentId: ResearchAgentId;
  round: number;
  question: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface AgentRun {
  id: string;
  storyId: string;
  agentType: "research" | "editorial" | "form";
  agentId: number;
  taskId?: string;
  status: "completed" | "failed";
  summary: string;
  startedAt: string;
  finishedAt: string;
}

export interface AuditEvent {
  id: string;
  storyId?: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface Publication {
  id: string;
  storyId: string;
  mode: Mode;
  public: boolean;
  draftHash: string;
  draft: ArticleDraft;
  approvedBy: "James";
  approvedAt: string;
  publishedAt: string;
  status?: "published" | "retracted" | "removed";
  statusHistory?: { status: "published" | "retracted" | "removed"; note: string; actor: "James"; createdAt: string }[];
  correctionOf?: string;
  correctionReason?: string;
  access?: "public" | "members";
}

export interface NewsroomState {
  gatewayNotBefore?: number;
  schemaVersion: 1;
  stories: Story[];
  sourceItems: SourceItem[];
  tasks: ResearchTask[];
  runs: AgentRun[];
  audit: AuditEvent[];
  publications: Publication[];
  lastRunAt?: string;
}

export interface ResearchRequest {
  story: Story;
  agentId: ResearchAgentId;
  round: number;
  question: string;
  sourceItems: SourceItem[];
}
export interface ResearchResult { findings: FindingInput[]; sources?: SourceItem[] }
export interface DraftRequest { story: Story; sources: SourceItem[]; peAgentId: PeAgentId }
export interface DraftResult {
  headline: string;
  sentences: ArticleSentence[];
  researchRequests?: { agentId: ResearchAgentId; question: string }[];
}
export interface ResearchProvider {
  composeArticle?: import("./autonomous-contract").AutonomousProvider["composeArticle"];
  reviewArticle?: import("./autonomous-contract").AutonomousProvider["reviewArticle"];
  research(request: ResearchRequest): Promise<ResearchResult>;
  draft?(request: DraftRequest): Promise<DraftResult>;
}
export interface TargetedRetrievalRequest {
  story: Story;
  questions: string[];
  sourceItems: SourceItem[];
  maxItems: number;
  deadline: number;
}
/** The trusted adapter enforces registered sources, robots rules and its absolute deadline. */
export type TargetedRetriever = (request: TargetedRetrievalRequest) => Promise<{ items: SourceItem[]; errors?: { sourceId: string; message: string }[] }>;

export interface FormRunner {
  horse: string;
  form: string;
  class: string;
  barrier: number;
  distance: number;
  track: string;
  going: string;
  weight: number;
  jockey: string;
  trainer: string;
  trials: string;
  sourceIds: string[];
}
export interface FormAnalysis {
  id: string;
  status: "blocked" | "ready_for_review";
  selections: { horse: string; tier: "higher confidence" | "medium confidence" | "speculative/high-risk"; analysis: string; sourceIds: string[] }[];
  limitations: string[];
  createdAt: string;
}
