(() => {
  "use strict";

  function isHttp(url) {
    return /^https?:$/i.test(url.protocol);
  }

  function addCandidate(map, href, title) {
    try {
      const url = new URL(href, document.baseURI);
      if (!isHttp(url)) return;
      url.hash = "";
      if (!map.has(url.href)) map.set(url.href, { url: url.href, title: String(title || "").trim() });
    } catch (_error) {}
  }

  function collectCandidates() {
    const candidates = new Map();
    for (const link of document.querySelectorAll("link[href]")) {
      const rel = String(link.rel || "").toLowerCase();
      const type = String(link.type || "").toLowerCase();
      if (/\balternate\b/.test(rel) && /(?:rss|atom)\+xml|feed\+json/.test(type)) {
        addCandidate(candidates, link.href, link.title || document.title);
      }
    }
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (candidates.size >= 40) break;
      const label = String(anchor.textContent || "").replace(/\s+/g, " ").trim();
      const href = anchor.getAttribute("href") || "";
      if (/\.(?:rss|xml|atom|rdf)(?:$|[?#])/i.test(href) || /\b(?:rss|atom|feed url)\b/i.test(label)) {
        addCandidate(candidates, href, label);
      }
    }
    const pageText = String(document.body?.innerText || "").slice(0, 2 * 1024 * 1024);
    for (const match of pageText.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      if (candidates.size >= 40) break;
      const href = match[0].replace(/[),.;\]]+$/g, "");
      if (/\.(?:rss|xml|atom|rdf)(?:$|[?#])/i.test(href) || /(?:^|[\/_?&=.-])(?:rss|feed|atom)(?:$|[\/_?&=.-])/i.test(href)) {
        addCandidate(candidates, href, "Discovered feed");
      }
    }
    return Array.from(candidates.values());
  }

  const candidates = collectCandidates();
  chrome.runtime.sendMessage({ type: "page:feeds", data: { pageUrl: location.href, candidates } }).catch(() => undefined);
})();
