import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import type { SourceItem, SourceType, TargetedRetriever } from "./domain";

export const FETCH_LIMIT = 2 * 1024 * 1024;
const USER_AGENT = "RacingNewsroom/1.0";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes("%")) return false;
  const parts = address.toLowerCase().split(":");
  const first = parseInt(parts[0] || "0", 16);
  const second = parseInt(parts[1] || "0", 16);
  // Only global unicast. Exclude tunnels, documentation and special-use blocks.
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    !(first === 0x3fff && second < 0x1000);
}

export function validateSourceUrl(input: string, allowedHosts: readonly string[]): URL {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    hostname.endsWith(".") || isIP(hostname.replace(/^\[|\]$/g, "")) ||
    !allowedHosts.some((host) => host.toLowerCase() === hostname)) {
    throw new Error("Source URL must use HTTPS on an explicitly registered public hostname");
  }
  return url;
}

export interface FetchResult { body: string; bytes?: Buffer; url: string; contentType: string; status: number }

/** DNS is validated and pinned to this socket; redirects undergo the same checks. */
export async function safeFetchText(input: string, allowedHosts: readonly string[], options: { maxBytes?: number; timeoutMs?: number; allow404?: boolean; validateUrl?: (url: URL) => void } = {}): Promise<FetchResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const maximum = options.maxBytes ?? FETCH_LIMIT;
  let current = input;
  for (let redirect = 0; redirect < 4; redirect++) {
    const url = validateSourceUrl(current, allowedHosts);
    options.validateUrl?.(url);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Source request timed out");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Source DNS timed out")), remaining); }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Source DNS resolves to a private or reserved network");
    const pinned = addresses[0];
    const result = await new Promise<FetchResult & { location?: string }>((resolve, reject) => {
      const req = request(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/rss+xml,application/atom+xml,application/xml,text/plain", "accept-encoding": "identity" },
        family: pinned.family,
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      }, (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          resolve({ body: "", url: url.href, status, contentType: "", location: response.headers.location });
          return;
        }
        if (status === 404 && options.allow404) { response.resume(); resolve({ body: "", url: url.href, contentType: "", status }); return; }
        if (status < 200 || status >= 300) { response.resume(); reject(new Error(`Source returned HTTP ${status}; no access bypass attempted`)); return; }
        if (Number(response.headers["content-length"] ?? 0) > maximum) { response.destroy(); reject(new Error("Source response exceeds size limit")); return; }
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { response.destroy(); reject(new Error("Compressed source response is unsupported")); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maximum) { response.destroy(); reject(new Error("Source response exceeds size limit")); return; }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => { const bytes = Buffer.concat(chunks); resolve({ body: bytes.toString("utf8"), bytes, url: url.href, status, contentType: response.headers["content-type"] ?? "" }); });
      });
      const requestTimer = setTimeout(() => req.destroy(new Error("Source request timed out")), Math.max(1, deadline - Date.now()));
      req.once("close", () => clearTimeout(requestTimer));
      req.on("error", reject);
      req.end();
    });
    if (!result.location) {
      if (result.status >= 300 && result.status < 400) throw new Error("Source redirect omitted its destination");
      return result;
    }
    current = new URL(result.location, current).href;
  }
  throw new Error("Source exceeded redirect limit");
}

/** RFC 9309 longest matching rule; specific agent groups override wildcard groups. */
export function robotsAllows(body: string, pathname: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group: typeof groups[number] | undefined;
  for (const line of body.split(/\r?\n/)) {
    const clean = line.replace(/#.*/, "").trim();
    const colon = clean.indexOf(":");
    if (colon < 0) continue;
    const key = clean.slice(0, colon).trim().toLowerCase();
    const value = clean.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === "disallow" || key === "allow") && value) group.rules.push({ allow: key === "allow", path: value });
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && USER_AGENT.toLowerCase().includes(a)));
  const selected = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const matching = selected.flatMap((g) => g.rules).filter((rule) => {
    const end = rule.path.endsWith("$");
    const pattern = (end ? rule.path.slice(0, -1) : rule.path).split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${pattern}${end ? "$" : ""}`).test(pathname);
  }).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}

export function htmlToText(html: string): string {
  const $ = load(html);
  $("script,style,noscript,nav,header,footer,form,iframe,svg").remove();
  $("p,br,div,li,h1,h2,h3,tr").append("\n");
  return $.text().replace(/[\t ]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

export interface ParsedSourceEntry { title: string; url: string; text: string; publishedAt?: string; raw: string; mediaRefs?: { url: string; caption: string }[] }
export function parseFeed(raw: string, feedUrl: string, maxItems = 6): ParsedSourceEntry[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error("Source XML contains unsupported entity declarations");
  const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false }).parse(raw);
  const entries = xml.rss?.channel?.item ?? xml.feed?.entry ?? [];
  return (Array.isArray(entries) ? entries : [entries]).slice(0, maxItems).map((entry): ParsedSourceEntry | null => {
    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const link = links.find((v: string | { "@_rel"?: string; "@_href"?: string }) => typeof v === "string" || (v && (!v["@_rel"] || v["@_rel"] === "alternate")));
    const href = typeof link === "string" ? link : link?.["@_href"];
    if (!href) return null;
    const scalar = (v: unknown) => typeof v === "string" ? v : (v && typeof v === "object" && "#text" in v) ? String(v["#text"]) : "";
    const original = scalar(entry["content:encoded"] ?? entry.content ?? entry.description ?? entry.summary);
    const date = scalar(entry.pubDate ?? entry.published ?? entry.updated);
    return { title: scalar(entry.title).slice(0, 300), url: new URL(href, feedUrl).href, text: htmlToText(original).slice(0, 24_000), raw: JSON.stringify(entry), publishedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined };
  }).filter((entry): entry is ParsedSourceEntry => Boolean(entry));
}

export const contentId = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

export interface RegisteredSource {
  id: string;
  name: string;
  url: string;
  allowedHosts: string[];
  format: "rss" | "html";
  type: SourceType;
  region: string;
  enabled: boolean;
  termsReviewedAt?: string;
  articlePathPrefix?: string;
  notes: string;
}

export function extractArticleLinks(html: string, source: RegisteredSource, maximum: number): string[] {
  const $ = load(html);
  $("nav,header,footer,script,style").remove();
  const scope = $("main").length ? $("main").first() : $("body");
  const origin = new URL(source.url).origin;
  return [...new Set(scope.find("a[href]").map((_, element) => {
    try {
      const url = new URL($(element).attr("href")!, source.url);
      if (url.origin !== origin || !source.articlePathPrefix || !url.pathname.startsWith(source.articlePathPrefix) || url.href === source.url || /\/(category|tag|page|magazines)(\/|$)/i.test(url.pathname)) return "";
      url.hash = "";
      return url.href;
    } catch { return ""; }
  }).get().filter(Boolean))].slice(0, maximum);
}

/** Collection is a bounded registered corpus, not unrestricted web research. */
export function getSourceRegistry(): RegisteredSource[] {
  const enabled = new Set((process.env.NEWSROOM_ENABLED_SOURCES ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  const reviewed = process.env.NEWSROOM_SOURCE_REVIEWED_AT;
  return [
    { id: "racing-nsw", name: "Racing NSW", url: "https://www.racingnsw.com.au/feed/", allowedHosts: ["www.racingnsw.com.au", "racingnsw.com.au"], format: "rss", type: "official", region: "NSW", notes: "RSS endpoint requires a live access and terms review before enabling." },
    { id: "racing-victoria", name: "Racing Victoria", url: "https://www.racingvictoria.com.au/news", allowedHosts: ["www.racingvictoria.com.au"], format: "html", type: "official", region: "VIC", articlePathPrefix: "/news/", notes: "News index may require JavaScript; unavailable article links are reported, never bypassed. Review access and reproduction terms." },
    { id: "racing-queensland", name: "Racing Queensland", url: "https://www.racingqueensland.com.au/news/category/thoroughbred", allowedHosts: ["www.racingqueensland.com.au"], format: "html", type: "official", region: "QLD", articlePathPrefix: "/news/20", notes: "Thoroughbred news index; bounded article collection was tested. Review access and reproduction terms before enabling." },
  ].map((source) => ({ ...source, enabled: enabled.has(source.id), termsReviewedAt: reviewed })) as RegisteredSource[];
}

export async function collectSourceItems(options: { sources?: RegisteredSource[]; maxSources?: number; maxItemsPerSource?: number; deadline?: number; fetchText?: typeof safeFetchText } = {}): Promise<{ items: SourceItem[]; errors: { sourceId: string; message: string }[] }> {
  const items: SourceItem[] = [];
  const errors: { sourceId: string; message: string }[] = [];
  const sources = (options.sources ?? getSourceRegistry()).filter((source) => source.enabled).slice(0, Math.min(options.maxSources ?? 3, 6));
  if (!sources.length) return { items, errors: [{ sourceId: "configuration", message: "No live sources enabled. Review source access/terms, then set NEWSROOM_ENABLED_SOURCES and NEWSROOM_SOURCE_REVIEWED_AT." }] };
  const maximum = Math.max(1, Math.min(options.maxItemsPerSource ?? 3, 6));
  const fetchWithinBudget: typeof safeFetchText = (url, hosts, fetchOptions = {}) => {
    const remaining = (options.deadline ?? (Date.now() + 15_000)) - Date.now();
    if (remaining <= 0) throw new Error("Source collection deadline exhausted");
    return (options.fetchText ?? safeFetchText)(url, hosts, { ...fetchOptions, timeoutMs: Math.max(1, Math.min(15_000, remaining)) });
  };
  for (const source of sources) {
    try {
      if (!source.termsReviewedAt || !Number.isFinite(Date.parse(source.termsReviewedAt)) || Date.parse(source.termsReviewedAt) > Date.now()) throw new Error("Source access and terms review is missing or invalid");
      const sourceUrl = validateSourceUrl(source.url, source.allowedHosts);
      const robots = await fetchWithinBudget(new URL("/robots.txt", sourceUrl).href, source.allowedHosts, { maxBytes: 256_000, allow404: true });
      const permitted = (url: string) => {
        const target = validateSourceUrl(url, source.allowedHosts);
        // Each origin needs its own robots policy; do not follow links to other origins.
        if (target.origin !== sourceUrl.origin || !robotsAllows(robots.body, target.pathname + target.search)) throw new Error("Source robots policy or origin restriction disallows this URL");
      };
      permitted(source.url);
      const fetched = await fetchWithinBudget(source.url, source.allowedHosts, { validateUrl: (url) => permitted(url.href) });
      permitted(fetched.url);
      const retrievedAt = new Date().toISOString();
      let entries: ParsedSourceEntry[];
      if (source.format === "rss") {
        if (!/xml|rss|atom|text\/plain/i.test(fetched.contentType)) throw new Error("RSS endpoint did not return XML");
        entries = parseFeed(fetched.body, fetched.url, maximum);
        entries = entries.filter((entry) => { try { permitted(entry.url); return true; } catch { errors.push({ sourceId: source.id, message: "Skipped an off-origin or robots-restricted feed entry" }); return false; } });
      } else {
        if (!/text\/html/i.test(fetched.contentType)) throw new Error("HTML source did not return a web page");
        const urls = extractArticleLinks(fetched.body, source, maximum);
        entries = [];
        for (const url of urls) {
          try {
            permitted(url);
            const article = await fetchWithinBudget(url, source.allowedHosts, { validateUrl: (target) => permitted(target.href) });
            permitted(article.url);
            if (!/text\/html/i.test(article.contentType)) throw new Error("Article did not return HTML");
            const page = load(article.body);
            const title = page("h1").first().text().trim() || page("title").text().trim();
            const timestamp = page('meta[property="article:published_time"]').attr("content") || page("time[datetime]").first().attr("datetime");
            const main = page("article").first().html() || page("main").first().html();
            if (!main) throw new Error("No readable article body; site may require JavaScript");
            const candidateImage = page('meta[property="og:image"]').attr("content");
            const mediaRefs: { url: string; caption: string }[] = [];
            if (candidateImage) {
              try {
                const image = new URL(candidateImage, article.url);
                if (image.protocol === "https:") mediaRefs.push({ url: image.href, caption: page('meta[property="og:image:alt"]').attr("content") ?? "Publisher image; caption and provenance unverified" });
              } catch { /* Invalid image references are not fetched or rendered. */ }
            }
            entries.push({ title, url: article.url, text: htmlToText(main).slice(0, 24_000), raw: article.body, mediaRefs, publishedAt: timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : undefined });
          } catch (error) { errors.push({ sourceId: source.id, message: error instanceof Error ? error.message : "Article collection failed" }); }
        }
      }
      if (!entries.length) throw new Error("No readable items found; check the registered feed URL or site rendering requirements");
      for (const entry of entries) {
        if (!entry.text || !entry.title) continue;
        const id = `src_${contentId(entry.url + "\n" + entry.text)}`;
        items.push({ id, title: entry.title.slice(0, 300), content: entry.text, url: entry.url, type: source.type, sourceName: source.name, independenceKey: source.id, region: source.region, publishedAt: entry.publishedAt ?? retrievedAt, publishedAtKnown: Boolean(entry.publishedAt), retrievedAt, rawOriginal: entry.raw, demo: false,
          media: entry.mediaRefs?.map((media) => ({ id: `media_${contentId(media.url)}`, url: media.url, sourceId: id, earliestSource: null, proposedCaption: media.caption, context: "unknown", date: null, location: null, manipulation: "unknown", aiStatus: "unknown", reuseHistory: [], captionSupported: false, rights: "unknown", allowed: false })),
        });
      }
    } catch (error) { errors.push({ sourceId: source.id, message: error instanceof Error ? error.message : "Source collection failed" }); }
  }
  return { items, errors };
}

/** Fresh targeted collection is restricted to owner-enabled, reviewed sources; model URLs are never fetched. */
export function createTargetedRetriever(sources: RegisteredSource[], options: { fetchText?: typeof safeFetchText } = {}): TargetedRetriever {
  const registered = structuredClone(sources);
  return async request => {
    const maximum = Math.max(0, Math.min(2, Math.floor(request.maxItems)));
    if (!maximum || Date.now() >= request.deadline) return { items: [], errors: [{ sourceId: "budget", message: "Targeted retrieval budget exhausted." }] };
    const query = `${request.story.title} ${request.questions.join(" ")}`.toLowerCase();
    const knownOrigins = new Set(request.sourceItems.map(item => item.independenceKey));
    const ranked = registered.filter(source => source.enabled).map(source => ({ source, score: (source.type === "official" || source.type === "data" ? 4 : 0) + (query.includes(source.region.toLowerCase()) ? 3 : 0) + (!knownOrigins.has(source.id) ? 2 : 0) })).sort((a, b) => b.score - a.score).slice(0, maximum).map(item => item.source);
    const result = await collectSourceItems({ sources: ranked, maxSources: maximum, maxItemsPerSource: 1, deadline: Math.min(request.deadline, Date.now() + 20_000), fetchText: options.fetchText });
    const ignored = new Set(["the", "and", "for", "with", "from", "that", "this", "racing", "thoroughbred", "authority", "official", "record", "records", "update", "correction", "briefing", "news"]);
    const terms = [...new Set(request.story.title.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter(term => !ignored.has(term));
    const knownIds = new Set(request.sourceItems.map(item => item.id));
    const items = result.items.filter(item => {
      if (knownIds.has(item.id)) return false;
      const text = `${item.title} ${item.content}`.toLowerCase();
      const matches = terms.filter(term => new RegExp(`\\b${term}\\b`).test(text));
      return matches.length >= Math.min(2, terms.length) && terms.length > 0;
    }).slice(0, maximum);
    if (!items.length) result.errors.push({ sourceId: "relevance", message: "No additional relevant material was found in the bounded registered sources. Evidence questions remain open." });
    return { items, errors: result.errors };
  };
}
