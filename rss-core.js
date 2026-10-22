(function (root, factory) {
  const api = factory();
  root.NewsFeedCore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_DOCUMENT_BYTES = 6 * 1024 * 1024;
  const MAX_CANDIDATES = 60;
  const ENTITY_MAP = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
    ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
    rdquo: "”", ldquo: "“", copy: "©", reg: "®"
  };

  function decodeEntities(value) {
    return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const radix = entity[1].toLowerCase() === "x" ? 16 : 10;
        const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
        const codePoint = Number.parseInt(digits, radix);
        try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match; }
        catch (_error) { return match; }
      }
      return Object.prototype.hasOwnProperty.call(ENTITY_MAP, entity.toLowerCase())
        ? ENTITY_MAP[entity.toLowerCase()]
        : match;
    });
  }

  function cleanText(value, maxLength = 0) {
    let text = String(value || "")
      .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, "$1")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
    text = decodeEntities(text);
    text = text.replace(/<[^>]*>/g, " ");
    text = decodeEntities(text).replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
    if (maxLength && text.length > maxLength) return `${text.slice(0, maxLength - 1).trim()}…`;
    return text;
  }

  function normalizeHttpUrl(value, baseUrl) {
    const input = decodeEntities(value).trim();
    if (!input || /^(?:javascript|data|mailto|tel|chrome|about):/i.test(input)) return null;
    try {
      const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
      const resemblesFeedFilename = /^(?:\.{0,2}\/)?[^/]+\.(?:xml|rss|atom|rdf|json)(?:[?#]|$)/i.test(input);
      const resemblesHostname = /^(?:localhost(?::\d+)?|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?)(?:[/?#]|$)/i.test(input);
      const target = !hasScheme && resemblesHostname && !resemblesFeedFilename ? `https://${input}` : input;
      const url = baseUrl ? new URL(target, baseUrl) : new URL(hasScheme ? input : `https://${input}`);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.hash = "";
      return url.href;
    } catch (_error) {
      return null;
    }
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function tagExpression(name) {
    if (name.includes(":")) return escapeRegExp(name);
    return `(?:[\\w.-]+:)?${escapeRegExp(name)}`;
  }

  function rawTag(block, names) {
    for (const name of names) {
      const tag = tagExpression(name);
      const match = String(block || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i"));
      if (match) return match[1];
    }
    return "";
  }

  function textTag(block, names, maxLength = 0) {
    return cleanText(rawTag(block, names), maxLength);
  }

  function getAttribute(markup, name) {
    const escaped = escapeRegExp(name);
    const match = String(markup || "").match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:(["'])([\\s\\S]*?)\\1|([^\\s>]+))`, "i"));
    return decodeEntities(match ? (match[2] || match[3] || "") : "");
  }

  function firstLink(block, baseUrl, atomStyle = false) {
    if (atomStyle) {
      const links = Array.from(String(block || "").matchAll(/<(?:(?:[\w.-]+):)?link\b[^>]*>/gi));
      const preferred = links.find(match => {
        const rel = getAttribute(match[0], "rel").toLowerCase();
        return (!rel || rel === "alternate") && getAttribute(match[0], "href");
      }) || links.find(match => getAttribute(match[0], "href"));
      const href = preferred ? getAttribute(preferred[0], "href") : "";
      const normalized = normalizeHttpUrl(href, baseUrl);
      if (normalized) return normalized;
    }
    return normalizeHttpUrl(textTag(block, ["link"]), baseUrl);
  }

  function dateValue(value) {
    const timestamp = Date.parse(cleanText(value));
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function stableHash(value) {
    let hash = 2166136261;
    const input = String(value || "");
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function imageFromXml(block, baseUrl) {
    const tags = String(block || "").match(/<(?:(?:media):(?:thumbnail|content)|enclosure)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const lowerTag = tag.toLowerCase();
      const type = getAttribute(tag, "type").toLowerCase();
      const medium = getAttribute(tag, "medium").toLowerCase();
      const rawUrl = getAttribute(tag, "url");
      const imageExtension = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(rawUrl);
      if (lowerTag.includes("enclosure")) {
        if (type ? !type.startsWith("image/") : !/\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(rawUrl)) continue;
      }
      if (lowerTag.includes("media:content") && medium !== "image" && !type.startsWith("image/") && !(!type && !medium && imageExtension)) continue;
      const url = normalizeHttpUrl(rawUrl, baseUrl);
      if (url) return url;
    }
    return null;
  }

  function makeItem(block, feedUrl, atomStyle) {
    const rawGuid = textTag(block, ["guid", "id"], 1000);
    const guidLink = /^(?:https?:)?\/\//i.test(rawGuid) ? normalizeHttpUrl(rawGuid, feedUrl) : null;
    const link = firstLink(block, feedUrl, atomStyle) || guidLink;
    const title = textTag(block, ["title"], 400) || "Untitled item";
    const guid = rawGuid || link || `${title}|${rawTag(block, ["pubDate", "published", "updated", "date"])}`;
    const publishedAt = dateValue(rawTag(block, ["pubDate", "published", "updated", "dc:date", "date"]));
    const summary = textTag(block, ["description", "summary", "content:encoded", "content"], 700);
    return {
      id: stableHash(`${feedUrl}|${guid}`),
      guid,
      title,
      link,
      summary,
      author: textTag(block, ["author", "dc:creator", "creator"], 200),
      publishedAt,
      imageUrl: imageFromXml(block, feedUrl)
    };
  }

  function parseJsonFeed(text, sourceUrl) {
    const trimmed = String(text || "").trim();
    if (!trimmed.startsWith("{")) return null;
    let data;
    try { data = JSON.parse(trimmed); }
    catch (_error) { return null; }
    if (!data || !Array.isArray(data.items) || !/jsonfeed\.org/i.test(String(data.version || ""))) return null;
    const feedUrl = normalizeHttpUrl(data.feed_url, sourceUrl) || sourceUrl;
    const items = data.items.map(item => {
      const link = normalizeHttpUrl(item.url || item.external_url, feedUrl);
      const guid = String(item.id || link || `${item.title || ""}|${item.date_published || ""}`);
      const attachment = Array.isArray(item.attachments)
        ? item.attachments.find(value => String(value?.mime_type || "").startsWith("image/"))
        : null;
      return {
        id: stableHash(`${feedUrl}|${guid}`), guid,
        title: cleanText(item.title || item.summary || "Untitled item", 400),
        link,
        summary: cleanText(item.summary || item.content_text || item.content_html, 700),
        author: cleanText(item.author?.name || item.authors?.[0]?.name, 200),
        publishedAt: dateValue(item.date_published || item.date_modified),
        imageUrl: normalizeHttpUrl(item.image || item.banner_image || attachment?.url, feedUrl)
      };
    });
    return {
      format: "json", url: feedUrl,
      title: cleanText(data.title, 300) || hostnameTitle(feedUrl),
      siteUrl: normalizeHttpUrl(data.home_page_url, feedUrl),
      description: cleanText(data.description, 700),
      items: deduplicateItems(items)
    };
  }

  function hostnameTitle(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ""); }
    catch (_error) { return "RSS feed"; }
  }

  function deduplicateItems(items) {
    const seen = new Set();
    return (items || []).filter(item => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  function parseFeed(text, sourceUrl, contentType = "") {
    const body = String(text || "").slice(0, MAX_DOCUMENT_BYTES).replace(/^\uFEFF/, "");
    const resolvedUrl = normalizeHttpUrl(sourceUrl) || sourceUrl;
    const json = parseJsonFeed(body, resolvedUrl);
    if (json) return json;

    const hasRssRoot = /<(?:(?:[\w.-]+:)?rss|rdf:RDF)\b/i.test(body);
    const hasAtomRoot = /<(?:[\w.-]+:)?feed\b/i.test(body);
    if (!hasRssRoot && !hasAtomRoot) return null;

    if (hasAtomRoot && !hasRssRoot) {
      const feedMatch = body.match(/<(?:[\w.-]+:)?feed\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?feed\s*>/i);
      if (!feedMatch) return null;
      const feedBase = normalizeHttpUrl(getAttribute(feedMatch[1], "xml:base"), resolvedUrl) || resolvedUrl;
      const feedBlock = feedMatch[2];
      const entryMatches = Array.from(feedBlock.matchAll(/<(?:[\w.-]+:)?entry\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?entry\s*>/gi));
      const metadata = feedBlock.replace(/<(?:[\w.-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?entry\s*>/gi, "");
      const feedUrl = resolvedUrl;
      const items = entryMatches.map(match => {
        const entryBase = normalizeHttpUrl(getAttribute(match[1], "xml:base"), feedBase) || feedBase;
        return makeItem(match[2], entryBase, true);
      });
      if (!items.length && !textTag(metadata, ["title"])) return null;
      return {
        format: "atom", url: feedUrl,
        title: textTag(metadata, ["title"], 300) || hostnameTitle(feedUrl),
        siteUrl: firstLink(metadata, feedBase, true),
        description: textTag(metadata, ["subtitle", "description"], 700),
        items: deduplicateItems(items)
      };
    }

    const channelMatch = body.match(/<(?:[\w.-]+:)?channel\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?channel\s*>/i);
    const channelBlock = channelMatch ? channelMatch[1] : body;
    const itemMatches = Array.from(body.matchAll(/<(?:[\w.-]+:)?item\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?item\s*>/gi));
    const metadata = channelBlock.replace(/<(?:[\w.-]+:)?item\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?item\s*>/gi, "");
    const feedUrl = resolvedUrl;
    const items = itemMatches.map(match => makeItem(match[1], feedUrl, false));
    if (!items.length && !textTag(metadata, ["title"])) return null;
    return {
      format: "rss", url: feedUrl,
      title: textTag(metadata, ["title"], 300) || hostnameTitle(feedUrl),
      siteUrl: firstLink(metadata, feedUrl, false),
      description: textTag(metadata, ["description", "subtitle"], 700),
      items: deduplicateItems(items)
    };
  }

  function isLikelyFeedUrl(url, label = "", markup = "") {
    let parsed;
    try { parsed = new URL(url); }
    catch (_error) { return false; }
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
    return /\.(?:rss|xml|atom|rdf|json)(?:$|[?#])/i.test(path) ||
      /(?:^|[\/_?&=.-])(?:rss|feed|feeds|atom)(?:$|[\/_?&=.-])/i.test(path) ||
      /\b(?:rss|atom|xml feed|news feed|feed url)\b/i.test(label) ||
      /application\/(?:rss|atom)\+xml|application\/feed\+json/i.test(markup);
  }

  function extractFeedCandidates(html, baseUrl) {
    const body = String(html || "").slice(0, MAX_DOCUMENT_BYTES);
    const baseTag = body.match(/<base\b[^>]*>/i);
    const documentBase = baseTag ? normalizeHttpUrl(getAttribute(baseTag[0], "href"), baseUrl) || baseUrl : baseUrl;
    const normalizedPageUrl = normalizeHttpUrl(baseUrl);
    const candidates = new Map();
    const add = (href, title, markup, forced = false) => {
      const url = normalizeHttpUrl(href, documentBase);
      if (!url || (!forced && !isLikelyFeedUrl(url, title, markup))) return;
      if (url === normalizedPageUrl) return;
      if (!candidates.has(url)) candidates.set(url, { url, title: cleanText(title, 200) || hostnameTitle(url) });
    };

    for (const match of body.matchAll(/<link\b[^>]*>/gi)) {
      const href = getAttribute(match[0], "href");
      const rel = getAttribute(match[0], "rel").toLowerCase();
      const type = getAttribute(match[0], "type").toLowerCase();
      const feedType = /(?:rss|atom)\+xml|feed\+json/.test(type);
      if (href && (feedType || /\balternate\b/.test(rel) && isLikelyFeedUrl(normalizeHttpUrl(href, baseUrl) || "", "", match[0]))) {
        add(href, getAttribute(match[0], "title"), match[0], feedType);
      }
    }

    for (const match of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
      const href = getAttribute(match[1], "href");
      if (href) add(href, cleanText(match[2], 200), match[0]);
    }

    for (const match of body.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) {
      const url = match[0].replace(/[),.;\]]+$/g, "");
      add(url, "", url);
    }
    return Array.from(candidates.values()).slice(0, MAX_CANDIDATES);
  }

  function commonFeedCandidates(pageUrl) {
    const normalized = normalizeHttpUrl(pageUrl);
    if (!normalized) return [];
    const url = new URL(normalized);
    return ["/feed", "/feed.xml", "/rss", "/rss.xml", "/atom.xml"]
      .map(path => ({ url: new URL(path, url.origin).href, title: hostnameTitle(url.href) }));
  }

  return {
    MAX_DOCUMENT_BYTES,
    cleanText,
    decodeEntities,
    extractFeedCandidates,
    commonFeedCandidates,
    isLikelyFeedUrl,
    normalizeHttpUrl,
    parseFeed,
    stableHash
  };
});
