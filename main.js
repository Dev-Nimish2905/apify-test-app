const { Actor } = require("apify");
const { ApifyClient } = require("apify-client");

async function main() {
  await Actor.init();

  const client = new ApifyClient({
    token: process.env.APIFY_TOKEN || Actor.config.get("token"),
  });
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
      // ✅ CORRECT: startUrls is the only accepted input mode
      // Pass full Reddit URLs — /new/ and /top/?t=month for max signal
      const [runNew, runTop] = await Promise.all([
        client.actor("trudax/reddit-scraper-lite").call({
          startUrls: [{ url: `https://www.reddit.com/r/${sr}/new/` }],
          maxItems: 75,
          maxComments: 3,
          proxy: {
            useApifyProxy: true,
            apifyProxyGroups: ["RESIDENTIAL"],
          },
        }),
        client.actor("trudax/reddit-scraper-lite").call({
          startUrls: [{ url: `https://www.reddit.com/r/${sr}/top/?t=month` }],
          maxItems: 50,
          maxComments: 3,
          proxy: {
            useApifyProxy: true,
            apifyProxyGroups: ["RESIDENTIAL"],
          },
        }),
      ]);

      // Fetch results from both runs
      const [newResults, topResults] = await Promise.all([
        client.dataset(runNew.defaultDatasetId).listItems(),
        client.dataset(runTop.defaultDatasetId).listItems(),
      ]);

      const allItems = [...newResults.items, ...topResults.items];
      console.log(`📦 Raw posts from r/${sr}: ${allItems.length}`);

      // Log field names on first subreddit to confirm structure
      if (allItems.length > 0) {
        console.log(`🔑 Fields: ${Object.keys(allItems[0]).join(", ")}`);
      }

      let savedCount = 0;

      for (const post of allItems) {
        // Cover all possible body field names
        const bodyText =
          post.body || post.text || post.selftext || post.description || "";

        const fullText = `${post.title || ""} ${bodyText}`.toLowerCase();

        const matchedKeywords = PAIN_KEYWORDS.filter((kw) =>
          fullText.includes(kw)
        );

        // Save ALL posts on first run so you can verify data quality
        // Once confirmed working, add: if (matchedKeywords.length === 0) continue;

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
    }

    // Delay between subreddits to avoid hammering Apify
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log("\n✅ Done. Check dataset: reddit-pain-points");
  await Actor.exit();
}

main().catch(console.error);
