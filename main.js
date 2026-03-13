const { Actor } = require("apify");
const { ApifyClient } = require("apify-client");

async function main() {
  await Actor.init();

  const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
  const dataset = await Actor.openDataset("reddit-pain-points");

  // Targeted subreddits mapped to your 4 sectors
  const targets = [
    // --- LEGAL (biggest gap in Anthropic chart) ---
    { sr: "Lawyertalk", sector: "Legal" },
    { sr: "paralegal", sector: "Legal" },
    { sr: "LegalTech", sector: "Legal" },
    { sr: "lawyers", sector: "Legal" },

    // --- EDUCATION & LIBRARY ---
    { sr: "Teachers", sector: "Education" },
    { sr: "instructionaldesign", sector: "Education" },
    { sr: "edtech", sector: "Education" },
    { sr: "highereducation", sector: "Education" },

    // --- HEALTHCARE ---
    { sr: "medicine", sector: "Healthcare" },
    { sr: "nursing", sector: "Healthcare" },
    { sr: "HealthIT", sector: "Healthcare" },
    { sr: "physicianassistant", sector: "Healthcare" },
    { sr: "Radiology", sector: "Healthcare" },

    // --- OFFICE & ADMIN / BUSINESS ---
    { sr: "humanresources", sector: "Office & Admin" },
    { sr: "BusinessIntelligence", sector: "Office & Admin" },
    { sr: "sysadmin", sector: "Office & Admin" },
    { sr: "Accounting", sector: "Office & Admin" },
    { sr: "projectmanagement", sector: "Office & Admin" },
  ];

  // High-signal pain point keywords
  // These surface posts where professionals describe REAL broken workflows
  const PAIN_KEYWORDS = [
    "i wish there was",
    "why is there no",
    "we still do this manually",
    "takes hours",
    "takes forever",
    "nobody has solved",
    "our workflow is broken",
    "i hate how",
    "we pay someone just to",
    "there has to be a better way",
    "so tedious",
    "nightmare to",
    "no good tool for",
    "automate this",
    "painful process",
    "manually every",
    "waste so much time",
    "duct tape solution",
    "spreadsheet for everything",
    "copy paste",
  ];

  for (const { sr, sector } of targets) {
    console.log(`\n🔍 Scraping r/${sr} [${sector}]`);

    try {
      const run = await client.actor("trudax/reddit-scraper-lite").call({
        startUrls: [
          { url: `https://www.reddit.com/r/${sr}/new/` },
          { url: `https://www.reddit.com/r/${sr}/top/?t=month` }, // top of month = validated pain
        ],
        maxPostCount: 75, // 75 per URL × 2 URLs = up to 150 posts per subreddit
        maxComments: 5, // Top 5 comments often have solutions/workarounds = more signal
        proxy: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"],
        },
      });

      const { items } = await client.dataset(run.defaultDatasetId).listItems();

      let savedCount = 0;

      for (const post of items) {
        const fullText = `${post.title} ${post.body || ""}`.toLowerCase();

        const matchedKeywords = PAIN_KEYWORDS.filter((kw) =>
          fullText.includes(kw)
        );

        // Only save posts that match at least 1 pain keyword
        // This keeps your LLM dataset clean and high-signal
        if (matchedKeywords.length === 0) continue;

        await dataset.pushData({
          sector,
          subreddit: sr,
          title: post.title,
          text: post.body || "",
          score: post.score || 0,
          comments: post.numberOfComments || 0,
          url: post.url,
          created: post.createdAt,
          matchedKeywords, // tells your LLM WHY this post was flagged
          painSignalScore: matchedKeywords.length, // more matches = stronger signal
        });

        savedCount++;
      }

      console.log(`✓ Saved ${savedCount} pain-point posts from r/${sr}`);
    } catch (err) {
      console.error(`✗ Failed r/${sr}:`, err.message);
      // Continue to next subreddit, don't crash the whole run
    }
  }

  console.log("\n✅ Scraping complete. Dataset: reddit-pain-points");
  await Actor.exit();
}

main().catch(console.error);
