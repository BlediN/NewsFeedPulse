"use strict";

const assert = require("node:assert/strict");
const Core = require("../rss-core.js");

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example News</title><link>https://example.com/</link>
<description>News feed</description><item><title>First &amp; best</title>
<link>https://example.com/posts/1</link><guid>post-1</guid>
<description><![CDATA[<p>A short <strong>summary</strong>.</p>]]></description>
<pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
const parsedRss = Core.parseFeed(rss, "https://example.com/rss.xml", "application/rss+xml");
assert.equal(parsedRss.format, "rss");
assert.equal(parsedRss.title, "Example News");
assert.equal(parsedRss.items.length, 1);
assert.equal(parsedRss.items[0].title, "First & best");
assert.equal(parsedRss.items[0].summary, "A short summary.");

const guidOnly = Core.parseFeed(`<rss><channel><title>GUID links</title><item><title>Linked by GUID</title><guid isPermaLink="true">https://example.com/guid-link</guid></item></channel></rss>`, "https://example.com/rss", "text/xml");
assert.equal(guidOnly.items[0].link, "https://example.com/guid-link");

const podcast = Core.parseFeed(`<rss><channel><title>Podcast</title><item><guid>episode</guid><title>Audio only</title><enclosure url="https://example.com/episode.mp3" /></item></channel></rss>`, "https://example.com/podcast.xml", "application/rss+xml");
assert.equal(podcast.items[0].imageUrl, null);

const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Example</title><link rel="alternate" href="/home" />
<entry><id>tag:example,1</id><title>Atom post</title><link href="/article/1" />
<summary>Atom summary</summary><updated>2026-10-21T12:00:00Z</updated></entry></feed>`;
const parsedAtom = Core.parseFeed(atom, "https://example.org/feed.atom", "application/atom+xml");
assert.equal(parsedAtom.format, "atom");
assert.equal(parsedAtom.siteUrl, "https://example.org/home");
assert.equal(parsedAtom.items[0].link, "https://example.org/article/1");

const basedAtom = Core.parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://cdn.example.org/root/"><title>Based Atom</title><entry xml:base="articles/"><id>one</id><title>Based post</title><link href="story" /></entry></feed>`, "https://example.org/feed.atom", "application/atom+xml");
assert.equal(basedAtom.items[0].link, "https://cdn.example.org/root/articles/story");

const jsonFeed = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1", title: "JSON Example",
  home_page_url: "https://json.example/", items: [{ id: "1", title: "JSON post", url: "/one" }]
});
const parsedJson = Core.parseFeed(jsonFeed, "https://json.example/feed.json", "application/feed+json");
assert.equal(parsedJson.format, "json");
assert.equal(parsedJson.items[0].link, "https://json.example/one");

const directory = `<html><body>
<p>Latest Headlines - <a href="https://moxie.foxnews.com/google-publisher/latest.xml">Latest</a></p>
<p>World - <a href="https://moxie.foxnews.com/google-publisher/world.xml">World</a></p>
<p><a href="/ordinary-story">Not a feed</a></p>
</body></html>`;
const candidates = Core.extractFeedCandidates(directory, "https://www.foxnews.com/story/foxnews-com-rss-feeds");
assert.deepEqual(candidates.map(value => value.url), [
  "https://moxie.foxnews.com/google-publisher/latest.xml",
  "https://moxie.foxnews.com/google-publisher/world.xml"
]);

const exactAttribute = Core.extractFeedCandidates(`<a data-href="/tracking" href="/feed.xml">RSS</a>`, "https://example.com/page");
assert.equal(exactAttribute[0].url, "https://example.com/feed.xml");

const basedCandidate = Core.extractFeedCandidates(`<base href="https://cdn.example.org/news/"><a href="updates.xml">RSS</a>`, "https://example.com/page");
assert.equal(basedCandidate[0].url, "https://cdn.example.org/news/updates.xml");

const hostCandidate = Core.extractFeedCandidates(`<a href="feeds.example.net/rss.xml">RSS</a>`, "https://example.com/page");
assert.equal(hostCandidate[0].url, "https://feeds.example.net/rss.xml");

const punctuatedCandidate = Core.extractFeedCandidates(`<p>Use https://example.net/feed.xml).</p>`, "https://example.com/page");
assert.equal(punctuatedCandidate[0].url, "https://example.net/feed.xml");

const namespacedRss = Core.parseFeed(`<x:rss xmlns:x="urn:rss"><x:channel><x:title>Namespaced RSS</x:title><x:item><x:guid>one</x:guid><x:title>Namespaced item</x:title><x:link>https://example.com/one</x:link></x:item></x:channel></x:rss>`, "https://example.com/namespaced.xml", "application/xml");
assert.equal(namespacedRss.items[0].title, "Namespaced item");

const rdf = Core.parseFeed(`<rdf:RDF xmlns:rdf="urn:rdf" xmlns:dc="urn:dc"><channel><title>RDF feed</title><link>https://example.com/</link></channel><item><title>RDF item</title><link>https://example.com/rdf-item</link><dc:date>2026-10-21T12:00:00Z</dc:date></item></rdf:RDF>`, "https://example.com/rdf.xml", "application/rdf+xml");
assert.equal(rdf.items[0].publishedAt, "2026-10-21T12:00:00.000Z");

const rssWithFeedExtension = Core.parseFeed(`<rss><channel><title>RSS with extension</title><feed>extension metadata</feed><item><guid>one</guid><title>Still RSS</title></item></channel></rss>`, "https://example.com/feed.xml", "application/rss+xml");
assert.equal(rssWithFeedExtension.format, "rss");

assert.equal(Core.parseFeed("<html><title>Not a feed</title></html>", "https://example.com/", "text/html"), null);
console.log("rss-core tests passed");
