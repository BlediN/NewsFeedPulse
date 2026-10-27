"use strict";

globalThis.NewsFeedPulseSourceCategories = Object.freeze([
  {
    title: "United States",
    sources: [
      { title: "NPR News", description: "Top stories", url: "https://feeds.npr.org/1001/rss.xml" },
      { title: "PBS NewsHour", description: "Headlines", url: "https://www.pbs.org/newshour/feeds/rss/headlines" },
      { title: "The New York Times", description: "U.S. news", url: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml", defaultFollowed: true },
      { title: "The Hill", description: "Politics and policy", url: "https://thehill.com/feed/" },
      { title: "Fox News", description: "Latest headlines", url: "https://moxie.foxnews.com/google-publisher/latest.xml", defaultFollowed: true },
      { title: "Google News", description: "Top U.S. stories", url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", defaultFollowed: true }
    ]
  },
  {
    title: "Albanian",
    sources: [
      { title: "Euronews Albania", description: "Latest news", url: "https://euronews.al/feed/", defaultFollowed: true },
      { title: "BalkanWeb", description: "Latest news", url: "https://www.balkanweb.com/feed/", defaultFollowed: true },
      { title: "Reporter.al", description: "Reporting and investigations", url: "https://www.reporter.al/feed/", defaultFollowed: true },
      { title: "Top Channel", description: "Latest news", url: "https://top-channel.tv/feed/" },
      { title: "Gazeta Shqiptare", description: "Latest Albanian news", url: "https://gazetashqiptare.al/feed/", defaultFollowed: true },
      { title: "A2 CNN", description: "Albanian and regional news", url: "https://a2news.com/feed" },
      { title: "Exit.al", description: "News and analysis", url: "https://exit.al/feed/" },
      { title: "Telegrafi", description: "Albanian-language news", url: "https://telegrafi.com/feed/" },
      { title: "Gazeta Express", description: "Albanian-language news", url: "https://www.gazetaexpress.com/feed/" }
    ]
  },
  {
    title: "International",
    sources: [
      { title: "BBC News", description: "World news", url: "https://feeds.bbci.co.uk/news/world/rss.xml", defaultFollowed: true },
      { title: "The Guardian", description: "World news", url: "https://www.theguardian.com/world/rss", defaultFollowed: true },
      { title: "Al Jazeera", description: "International news", url: "https://www.aljazeera.com/xml/rss/all.xml", defaultFollowed: true },
      { title: "Deutsche Welle", description: "International headlines", url: "https://rss.dw.com/rdf/rss-en-top" },
      { title: "France 24", description: "International news", url: "https://www.france24.com/en/rss" },
      { title: "UN News", description: "Global affairs", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml" }
    ]
  },
  {
    title: "Technology",
    sources: [
      { title: "The Verge", description: "Technology, products, and digital culture", url: "https://www.theverge.com/rss/index.xml", defaultFollowed: true },
      { title: "TechCrunch", description: "Startups and technology companies", url: "https://techcrunch.com/feed/" },
      { title: "Ars Technica", description: "Technology, science, and analysis", url: "https://feeds.arstechnica.com/arstechnica/index" },
      { title: "WIRED", description: "Technology, science, and culture", url: "https://www.wired.com/feed/rss" },
      { title: "MIT Technology Review", description: "Emerging technology and its impact", url: "https://www.technologyreview.com/feed/" },
      { title: "Engadget", description: "Consumer technology and product news", url: "https://www.engadget.com/rss.xml" }
    ]
  }
]);
