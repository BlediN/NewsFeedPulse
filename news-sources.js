"use strict";

globalThis.NewsFeedPulseSourceCategories = Object.freeze([
  {
    title: "U.S. News",
    sources: [
      {
        title: "Top stories - Google News",
        description: "Top U.S. stories",
        url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
        defaultFollowed: true,
      },
      {
        title: "NYT > U.S. News",
        description: "U.S. news and analysis",
        url: "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",
        defaultFollowed: true,
      },
      {
        title: "NPR News",
        description: "Top stories",
        url: "https://feeds.npr.org/1001/rss.xml",
      },
      {
        title: "PBS NewsHour",
        description: "Headlines",
        url: "https://www.pbs.org/newshour/feeds/rss/headlines",
      },
      {
        title: "The Hill",
        description: "Politics and policy",
        url: "https://thehill.com/feed/",
      },
      {
        title: "Fox News",
        description: "Latest headlines",
        url: "https://moxie.foxnews.com/google-publisher/latest.xml",
        defaultFollowed: true,
      },
    ],
  },
  {
    title: "World News",
    sources: [
      {
        title: "BBC News - World",
        description: "World news",
        url: "https://feeds.bbci.co.uk/news/world/rss.xml",
        defaultFollowed: true,
      },
      {
        title: "The Guardian - World",
        description: "World news",
        url: "https://www.theguardian.com/world/rss",
        defaultFollowed: true,
      },
      {
        title: "Al Jazeera",
        description: "International news",
        url: "https://www.aljazeera.com/xml/rss/all.xml",
        defaultFollowed: true,
      },
      {
        title: "Reuters (via Google News)",
        description: "Recent Reuters stories, collected by Google News",
        url: "https://news.google.com/rss/search?q=when:24h+site:reuters.com&ceid=US:en&hl=en-US&gl=US",
      },
      {
        title: "CNN International (via Google News)",
        description: "Recent CNN stories, collected by Google News",
        url: "https://news.google.com/rss/search?q=when:24h+site:cnn.com&hl=en-US&gl=US&ceid=US:en",
      },
      {
        title: "Deutsche Welle",
        description: "International headlines",
        url: "https://rss.dw.com/rdf/rss-en-top",
      },
      {
        title: "France 24",
        description: "International news",
        url: "https://www.france24.com/en/rss",
      },
      {
        title: "UN News",
        description: "Global affairs",
        url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
      },
    ],
  },
  {
    title: "Albanian News",
    sources: [
      {
        title: "Balkanweb.com – News24",
        description: "Latest Albanian news",
        url: "https://www.balkanweb.com/feed/",
        defaultFollowed: true,
      },
      {
        title: "Gazeta Shqiptare Online",
        description: "Latest Albanian news",
        url: "https://gazetashqiptare.al/feed/",
        defaultFollowed: true,
      },
      {
        title: "Telegrafi",
        description: "Albanian-language news",
        url: "https://telegrafi.com/feeds/feed.rss?geo=US",
        defaultFollowed: true,
      },
      {
        title: "Gazeta Express",
        description: "Albanian-language news",
        url: "https://www.gazetaexpress.com/feed/",
        defaultFollowed: true,
      },
      {
        title: "Reporter.al",
        description: "Reporting and investigations",
        url: "https://www.reporter.al/feed/",
        defaultFollowed: true,
      },
      {
        title: "Abc News",
        description: "Albanian and international headlines",
        url: "https://abcnews.al/feed/",
        defaultFollowed: true,
      },
      {
        title: "Vizion Plus",
        description: "News, analysis, and current affairs",
        url: "https://www.vizionplus.tv/feed/",
        defaultFollowed: true,
      },
      {
        title: "Euronews Albania",
        description: "Latest news",
        url: "https://euronews.al/feed/",
        defaultFollowed: true,
      },
      {
        title: "NEWS 24",
        description: "Albanian news and live coverage",
        url: "https://www.news24.al/feed/",
        defaultFollowed: true,
      },
      {
        title: "bota.al",
        description: "Albanian news and commentary",
        url: "https://bota.al/feed/",
        defaultFollowed: true,
      },
      {
        title: "Top Channel",
        description: "Latest news",
        url: "https://top-channel.tv/feed/",
      },
      {
        title: "A2 CNN",
        description: "Albanian and regional news",
        url: "https://a2news.com/feed",
      },
      {
        title: "Exit.al",
        description: "News and analysis",
        url: "https://exit.al/feed/",
      },
      {
        title: "JavaNews",
        description: "Albanian news",
        url: "https://javanews.al/feed/",
      },
      {
        title: "Tirana Times",
        description: "News and analysis in English",
        url: "https://www.tiranatimes.com/?feed=rss2",
      },
    ],
  },
  {
    title: "Technology & AI",
    sources: [
      {
        title: "The Verge",
        description: "Technology, products, and digital culture",
        url: "https://www.theverge.com/rss/index.xml",
        defaultFollowed: true,
      },
      {
        title: "TechCrunch",
        description: "Startups and technology companies",
        url: "https://techcrunch.com/feed/",
      },
      {
        title: "Ars Technica",
        description: "Technology, science, and analysis",
        url: "https://feeds.arstechnica.com/arstechnica/index",
      },
      {
        title: "WIRED",
        description: "Technology, science, and culture",
        url: "https://www.wired.com/feed/rss",
      },
      {
        title: "MIT Technology Review",
        description: "Emerging technology and its impact",
        url: "https://www.technologyreview.com/feed/",
      },
      {
        title: "Engadget",
        description: "Consumer technology and product news",
        url: "https://www.engadget.com/rss.xml",
      },
      {
        title: "Hacker News",
        description: "Technology, startups, and developer discussions",
        url: "https://hnrss.org/frontpage",
      },
      {
        title: "Google News - Technology",
        description: "Technology headlines from multiple publishers",
        url: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
      },
    ],
  },
  {
    title: "Sports",
    sources: [
      {
        title: "BBC Sport",
        description: "Sports headlines and results",
        url: "https://feeds.bbci.co.uk/sport/rss.xml",
      },
      {
        title: "BBC Sport - Football",
        description: "Football news and results",
        url: "https://feeds.bbci.co.uk/sport/football/rss.xml",
      },
      {
        title: "The Athletic",
        description: "Sports reporting and analysis",
        url: "https://www.nytimes.com/athletic/rss/news/",
      },
      {
        title: "Sky Sports - Football",
        description: "Football news and coverage",
        url: "https://www.skysports.com/rss/11095",
      },
      {
        title: "CBS Sports",
        description: "Sports headlines",
        url: "https://www.cbssports.com/rss/headlines/",
      },
      {
        title: "Google News - Sports",
        description: "Sports headlines from multiple publishers",
        url: "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en",
      },
    ],
  },
  {
    title: "Travel",
    sources: [
      {
        title: "BBC Travel",
        description: "Travel stories and destinations",
        url: "https://www.bbc.com/travel/feed.rss",
      },
      {
        title: "Travel + Leisure",
        description: "Destinations, travel news, and advice",
        url: "https://www.travelandleisure.com/feed",
      },
      {
        title: "Google News - Travel",
        description: "Travel headlines from multiple publishers",
        url: "https://news.google.com/rss/search?q=travel&hl=en-US&gl=US&ceid=US:en",
      },
    ],
  },
  {
    title: "Science & Environment",
    sources: [
      {
        title: "ScienceDaily - Top Science",
        description: "New research and science news",
        url: "https://www.sciencedaily.com/rss/top/science.xml",
      },
      {
        title: "BBC News - Science and Environment",
        description: "Science, climate, and environment",
        url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
      },
      {
        title: "NASA News Releases",
        description: "Space exploration and science updates",
        url: "https://www.nasa.gov/news-release/feed/",
      },
    ],
  },
  {
    title: "Business & Economy",
    sources: [
      {
        title: "MarketWatch - Top Stories",
        description: "Markets, business, and the economy",
        url: "https://feeds.marketwatch.com/marketwatch/topstories/",
      },
      {
        title: "BBC News - Business",
        description: "Business and economic news",
        url: "https://feeds.bbci.co.uk/news/business/rss.xml",
      },
      {
        title: "Google News - Business",
        description: "Business headlines from multiple publishers",
        url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en",
      },
    ],
  },
]);
