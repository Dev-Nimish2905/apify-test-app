const { Actor } = require("apify");
const { ApifyClient } = require("apify-client");

async function main() {
  await Actor.init();

  const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
  const dataset = await Actor.openDataset("reddit-pain-points");

  const targets = [
    // LEGAL
    { sr: "Lawyertalk", sector: "Legal" },
    { sr: "paralegal", sector: "Legal" },
    { sr: "LegalTech", sector: "Legal" },
    { sr: "lawyers", sector: "Legal" },

    // EDUCATION
    { sr: "Teachers", sector: "Education" },
    { sr: "instructionaldesign", sector: "Education" },
    { sr: "edtech", sector: "Education" },
    { sr: "highereducation", sector: "Education" },

    // HEALTHCARE
    { sr: "medicine", sector: "Healthcare" },
    { sr: "nursing", sector: "Healthcare" },
    { sr: "HealthIT", sector: "Healthcare" },
    { sr: "physicianassistant", sector: "Healthcare" },

    // OFFICE & ADMIN
    { sr: "humanresources", sector: "Office & Admin" },
    { sr: "BusinessIntelligence", sector: "Office & Admin" },
    { sr: "Accounting", sector: "Office & Admin" },
    { sr: "projectmanagement", sector: "Office & Admin" },
  ];

  const PAIN_KEYWORDS = [
    "i wish there was",
    "why is there no",
    "we still do this manually",
    "takes hours",
    "takes forever",
    "nobody has solved",
    "workflow is broken",
    "i hate how",
    "we pay someone just to",
    "there has to be a better way",
    "so tedious",
    "no good tool",
    "automate this",
    "painful process",
    "manually every",
    "waste so much time",
    "spreadsheet for everything",
    "copy paste",
    "copy-paste",
    "duct tape",
    "workaround",
    "nightmare to",
  ];

  for (const { sr, sector } of targets) {
    console.log(`\n🔍 Scraping r/${sr} [${sector}]`);

    try {
      // ---- FIX 1: Use subreddit + sort input instead of startUrls ----
      // startUrls triggers .json fetches → gets 403'd by Reddit
      // subreddit input mode uses browser scraping → bypasses block
      const runNew = await client.actor("trudax/reddit-scraper-lite").call({
        subreddit: sr,
        sort: "new",
        maxItems: 75, // confirmed correct param name
        maxPostCount: 75, // pass both to be safe across versions
        maxComments: 3,
        searchPosts: true,
        searchComments: false,
        searchCommunities: false,
        searchUsers: false,
        proxy: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"], // critical — fixes 403
        },
      });

      // Also run top/month for validated pain posts
      const runTop = await client.actor("trudax/reddit-scraper-lite").call({
        subreddit: sr,
        sort: "top",
        time: "month", // top of the month = upvoted = real pain
        maxItems: 50,
        maxPostCount: 50,
        maxComments: 3,
        searchPosts: true,
        searchComments: false,
        searchCommunities: false,
        searchUsers: false,
        proxy: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"],
        },
      });

      // Merge results from both runs
      const [newResults, topResults] = await Promise.all([
        client.dataset(runNew.defaultDatasetId).listItems(),
        client.dataset(runTop.defaultDatasetId).listItems(),
      ]);

      const allItems = [...newResults.items, ...topResults.items];
      console.log(
        `📦 Raw posts fetched from r/${sr}: ${
          allItems.items?.length || allItems.length
        }`
      );

      // ---- FIX 2: Debug first item to confirm field names ----
      if (allItems.length > 0) {
        console.log(
          `🔑 Fields available: ${Object.keys(allItems[0]).join(", ")}`
        );
      }

      let savedCount = 0;

      for (const post of allItems) {
        // ---- FIX 3: Cover ALL possible body field names ----
        // trudax scraper uses 'body' for post text based on issue reports
        const bodyText =
          post.body || // confirmed field in trudax scraper
          post.text || // fallback
          post.selftext || // Reddit API native name
          post.description || // some scrapers use this
          "";

        const fullText = `${post.title || ""} ${bodyText}`.toLowerCase();

        const matchedKeywords = PAIN_KEYWORDS.filter((kw) =>
          fullText.includes(kw)
        );

        // Save all posts on first run (comment out filter to debug)
        // if (matchedKeywords.length === 0) continue;

        await dataset.pushData({
          sector,
          subreddit: sr,
          title: post.title || "",
          text: bodyText,
          score: post.score || post.upVotes || 0,
          comments: post.numberOfComments || post.commentsCount || 0,
          url: post.url || post.postUrl || "",
          created: post.createdAt || post.parsedAt || "",
          matchedKeywords,
          painSignalScore: matchedKeywords.length,
        });

        savedCount++;
      }

      console.log(`✓ Saved ${savedCount} posts from r/${sr}`);
    } catch (err) {
      console.error(`✗ Failed r/${sr}: ${err.message}`);
      // Never crash full run — skip to next subreddit
    }

    // Polite delay between subreddits
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n✅ Done. Dataset: reddit-pain-points");
  await Actor.exit();
}

main().catch(console.error);
