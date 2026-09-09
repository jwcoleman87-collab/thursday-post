import type { ResearchProvider, SourceItem, FindingInput } from "./domain";

const timestamp = "2026-09-09T09:00:00.000Z";
export const DEMO_PRIMARY: SourceItem = {
  id: "demo-official-record",
  title: "Synthetic Harbour Racing safety consultation record",
  content: "Harbour Racing Authority opened a thoroughbred track safety consultation; it closes on 30 September 2026. No rule change has been adopted.",
  url: "https://example.invalid/demo/authority/consultation",
  type: "official",
  sourceName: "Harbour Racing Authority (fictional demo)",
  independenceKey: "demo-harbour-authority",
  publishedAt: timestamp,
  retrievedAt: timestamp,
  region: "NSW",
  demo: true,
};

export const DEMO_ITEMS: SourceItem[] = [
  {
    id: "demo-racing-news",
    title: "Racing safety consultation opens in Harbour district",
    content: "A fictional Harbour district racing publication reports that the racing authority is consulting on thoroughbred track safety reporting. A primary consultation record and the closing date have not yet been supplied.",
    url: "https://example.invalid/demo/racing-news",
    type: "publication",
    sourceName: "Harbour Racing Gazette (fictional demo)",
    independenceKey: "demo-harbour-gazette",
    publishedAt: timestamp,
    retrievedAt: timestamp,
    region: "NSW",
    demo: true,
    media: [{ id: "demo-photo", sourceId: "demo-racing-news", url: "https://example.invalid/demo/track-photo.jpg", earliestSource: null, proposedCaption: "Harbour track during the consultation", context: "unknown", date: null, location: null, manipulation: "unknown", aiStatus: "unknown", reuseHistory: [], captionSupported: false, rights: "unknown", allowed: false }],
  },
  {
    id: "demo-reader-email",
    title: "Racing safety consultation opens in Harbour district",
    content: "I heard the consultation has already made new thoroughbred track rules mandatory. Please check whether that is right.",
    url: "email:demo-reader-message-001",
    type: "email",
    sourceName: "Reader email (fictional demo)",
    independenceKey: "demo-reader-001",
    publishedAt: timestamp,
    retrievedAt: timestamp,
    isCorrection: true,
    demo: true,
    email: { messageId: "demo-reader-message-001", from: "reader@example.invalid", subject: "Please check the racing safety report", receivedAt: timestamp, original: "From: reader@example.invalid\nSubject: Please check the racing safety report\n\nI heard the consultation has already made new thoroughbred track rules mandatory. Please check whether that is right." },
  },
];

export const demoResearchProvider: ResearchProvider = {
  async research(request) {
    const findings: FindingInput[] = [];
    if (request.agentId === 1) {
      const item = request.sourceItems.find(s => s.type === "publication");
      if (item) findings.push({ text: item.content, kind: "record_statement", sourceIds: [item.id], quote: item.content.split(". ")[0] + ".", confidence: "medium" });
    }
    if (request.agentId === 2 && request.round > 0) {
      return { sources: [DEMO_PRIMARY], findings: [{ text: "The consultation is open; no rule has been adopted.", kind: "record_statement", sourceIds: [DEMO_PRIMARY.id], quote: DEMO_PRIMARY.content, confidence: "high" }] };
    }
    if (request.agentId === 4) {
      const item = request.sourceItems.find(s => s.type === "email");
      if (item) findings.push({ text: "Reader suggests that consultation proposals are already mandatory rules.", kind: "allegation", sourceIds: [item.id], quote: item.content, confidence: "low", questions: ["Check the primary record to distinguish a proposal from an adopted racing rule."] });
    }
    if (request.agentId === 6) {
      findings.push({ text: "The supplied lead describes one fictional NSW racing district; it does not establish Australia-wide rules.", kind: "inference", sourceIds: request.sourceItems.filter(s => s.type === "publication").map(s => s.id), confidence: "low", questions: ["No claim about other states is supported by this local record."] });
    }
    return { findings };
  },
};
