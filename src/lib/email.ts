import { simpleParser } from "mailparser";
import { Webhook } from "svix";
import { z } from "zod";
import type { SourceItem } from "./domain";
import { contentId, FETCH_LIMIT, htmlToText, safeFetchText } from "./ingestion";

export interface EmailLead {
  id: string;
  sourceItemId: string;
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  kind: "correction" | "eyewitness" | "question" | "tip" | "feedback";
  priority: "high" | "normal";
  verification: "unverified";
  originalFormat: "rfc822";
  attachments: { filename: string; contentType: string; size: number; checksum?: string }[];
}

export class AdapterConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = "AdapterConfigurationError"; }
}

export async function parseEmailFile(raw: Buffer | string): Promise<{ item: SourceItem; lead: EmailLead }> {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  if (!bytes.length || bytes.length > FETCH_LIMIT) throw new Error("Email must be between 1 byte and 2 MB");
  const parsed = await simpleParser(bytes, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, maxHtmlLengthToParse: FETCH_LIMIT });
  const from = parsed.from?.text ?? "Unknown sender";
  const subject = (parsed.subject ?? "Untitled reader email").slice(0, 300);
  const body = (parsed.text || (parsed.html ? htmlToText(parsed.html) : "")).slice(0, 24_000).trim();
  if (!body && !parsed.attachments.length) throw new Error("Email has no readable body or attachments");
  const retrievedAt = new Date().toISOString();
  const receivedAt = parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : retrievedAt;
  const digest = contentId(bytes.toString("base64"));
  const messageId = parsed.messageId ?? `import-${digest}`;
  const id = `email_${digest}`;
  const correction = /\b(correction|correct this|factual error|inaccurate|retraction)\b/i.test(subject + "\n" + body);
  const attachments = parsed.attachments.slice(0, 30).map((attachment) => ({ filename: attachment.filename ?? "unnamed attachment", contentType: attachment.contentType, size: attachment.size, checksum: attachment.checksum }));
  const item: SourceItem = {
    id, title: subject, content: body || "Reader supplied attachments. Contents have not been verified.",
    url: `email:${encodeURIComponent(messageId)}`, type: "email", sourceName: "Reader email (unverified)",
    // Forwarded copies and different claimed senders never constitute corroboration.
    independenceKey: "unverified-reader-mail", publishedAt: receivedAt, publishedAtKnown: Boolean(parsed.date), retrievedAt,
    isCorrection: correction, rawOriginal: bytes.toString("base64"),
    email: { messageId, from, subject, receivedAt, original: bytes.toString("base64"), originalEncoding: "base64", headers: parsed.headerLines.map(({ key, line }) => ({ key, line })), attachments },
    media: attachments.filter((attachment) => /^(image|video)\//.test(attachment.contentType)).map((attachment, index) => ({
      id: `media_${digest}_${index}`, url: `email-attachment:${id}/${index}`, sourceId: id,
      earliestSource: null, proposedCaption: attachment.filename, context: "unknown", date: null, location: null,
      manipulation: "unknown", aiStatus: "unknown", reuseHistory: [], captionSupported: false, rights: "unknown", allowed: false,
    })), demo: String(parsed.headers.get("x-racing-newsroom-demo") ?? "").trim().toLowerCase() === "true",
  };
  const kind = correction ? "correction" : /\b(i saw|eyewitness|i witnessed)\b/i.test(body) ? "eyewitness" : /\?/.test(subject) ? "question" : /\b(tip|lead|investigate|rumou?r)\b/i.test(body + subject) ? "tip" : "feedback";
  return { item, lead: { id: `lead_${digest}`, sourceItemId: id, messageId, from, subject, receivedAt, kind, priority: correction ? "high" : "normal", verification: "unverified", originalFormat: "rfc822", attachments } };
}

export async function readBoundedBody(input: Request | Response, maxBytes = FETCH_LIMIT): Promise<string> {
  if (Number(input.headers.get("content-length") ?? 0) > maxBytes) throw new Error("Request exceeds size limit");
  const reader = input.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Request exceeds size limit"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

const receivedEventSchema = z.object({ type: z.literal("email.received"), data: z.object({ email_id: z.string().uuid(), to: z.array(z.string().max(320)).max(100) }) });
const normalizeRecipient = (value: string) => value.trim().toLowerCase();
export type ResendWebhookResult = { ignored: false; item: SourceItem; lead: EmailLead; eventId: string } | { ignored: true; eventId: string; reason: "unrelated_event" | "unrelated_recipient" };

/** Verify the raw body before interpreting the event or contacting Resend. */
export async function receiveResendWebhook(request: Request): Promise<ResendWebhookResult> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = normalizeRecipient(process.env.NEWSROOM_INBOUND_ADDRESS ?? "");
  if (!secret || !apiKey || !z.email().safeParse(recipient).success) throw new AdapterConfigurationError("Resend inbound requires RESEND_WEBHOOK_SECRET, RESEND_API_KEY and a valid NEWSROOM_INBOUND_ADDRESS");
  const payload = await readBoundedBody(request, 128_000);
  const eventId = request.headers.get("svix-id") ?? "";
  const verified = new Webhook(secret).verify(payload, {
    "svix-id": eventId,
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  });
  if (z.object({ type: z.string() }).parse(verified).type !== "email.received") return { ignored: true, eventId, reason: "unrelated_event" };
  const event = receivedEventSchema.parse(verified);
  // Match the signed envelope recipient exactly: no domains, aliases, plus tags or substring matching.
  if (!event.data.to.some((address) => normalizeRecipient(address) === recipient)) return { ignored: true, eventId, reason: "unrelated_recipient" };
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(event.data.email_id)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) throw new Error(`Resend receiving API returned HTTP ${response.status}`);
  const received = z.object({ raw: z.object({ download_url: z.url() }).nullable() }).parse(JSON.parse(await readBoundedBody(response)));
  if (!received.raw) throw new Error("Resend original email is unavailable; retry while the original can still be retrieved");
  const download = new URL(received.raw.download_url);
  if (![".cloudfront.net", ".resend.com", ".resend.dev"].some((suffix) => download.hostname.endsWith(suffix))) throw new Error("Resend raw email URL uses an unexpected download host");
  // No Authorization header goes to the signed object URL. Its DNS and every redirect are checked.
  const original = await safeFetchText(download.href, [download.hostname]);
  if (!original.bytes) throw new Error("Resend original email download was empty");
  const parsed = await parseEmailFile(original.bytes);
  return { ...parsed, eventId, ignored: false };
}

/** Customer reply address and infrastructure sender have different purposes. */
export function getEmailConfiguration() {
  const contact = process.env.NEWSROOM_CONTACT_EMAIL || "workbenchadmin@gmail.com";
  const from = process.env.RESEND_FROM_EMAIL ?? "";
  const match = from.match(/<?([^<>\s]+@[^<>\s]+)>?$/);
  const senderDomain = match?.[1].split("@")[1].toLowerCase();
  return {
    contactEmail: contact, fromEmail: from || null,
    inboundConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET && z.email().safeParse(normalizeRecipient(process.env.NEWSROOM_INBOUND_ADDRESS ?? "")).success),
    senderConfigured: Boolean(senderDomain && !["gmail.com", "gmail.com.au", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com"].includes(senderDomain)),
    note: "Reader correspondence uses the contact address. Any future outbound sender must use a Resend-verified domain; mailbox ownership and domain verification are not inferred by this check.",
  };
}
