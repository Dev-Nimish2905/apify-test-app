console.log("🚀 Actor starting...");
const { Actor } = require("apify");
const { PuppeteerCrawler, Dataset } = require("crawlee");

async function main() {
  await Actor.init();

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

  const dataset = await Actor.openDataset("reddit-pain-points");

  // Build start URLs — new + top/month for each subreddit
  const startUrls = [];
  for (const { sr, sector } of targets) {
    startUrls.push({
      url: `https://www.reddit.com/r/${sr}/new/`,
      userData: { sr, sector, sort: "new" },
    });
    startUrls.push({
      url: `https://www.reddit.com/r/${sr}/top/?t=month`,
      userData: { sr, sector, sort: "top" },
    });
  }

  // Track post URLs already queued to avoid duplicates
  const queuedPostUrls = new Set();

  // Track how many posts saved per subreddit
  const savedCounts = {};

  const crawler = new PuppeteerCrawler({
    // Use Apify residential proxy — critical for bypassing Reddit blocks
    proxyConfiguration: await Actor.createProxyConfiguration({
      groups: ["RESIDENTIAL"],
    }),

    // Randomise user agent to avoid bot detection
    launchContext: {
      launchOptions: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      },
    },

    // Max 2 concurrent browsers — Reddit rate limits aggressive crawlers
    maxConcurrency: 2,

    // Retry each page up to 3 times on failure
    maxRequestRetries: 3,

    async requestHandler({ request, page, enqueueLinks, log }) {
      const { sr, sector, sort, isPost } = request.userData;

      // ── LISTING PAGE (subreddit feed) ──
      if (!isPost) {
        log.info(`📄 Listing: r/${sr} [${sort}]`);

        // Wait for Reddit's post feed to load
        await page
          .waitForSelector('div[data-testid="post-container"], shreddit-post', {
            timeout: 15000,
          })
          .catch(() => log.warning(`Selector timeout on r/${sr}`));

        // Extract all post links from the listing page
        const postLinks = await page.evaluate(() => {
          const anchors = Array.from(
            document.querySelectorAll('a[href*="/comments/"]')
          );
          return [
            ...new Set(
              anchors
                .map((a) => a.href)
                .filter((h) => h.includes("/comments/"))
                // Strip query params
                .map((h) => h.split("?")[0])
            ),
          ];
        });

        log.info(`  Found ${postLinks.length} post links on r/${sr}`);

        // Enqueue each post page for detailed scraping
        for (const link of postLinks.slice(0, 50)) {
          if (queuedPostUrls.has(link)) continue;
          queuedPostUrls.add(link);

          await enqueueLinks({
            urls: [link],
            transformRequestFunction: (req) => {
              req.userData = { sr, sector, isPost: true };
              return req;
            },
          });
        }
      }

      // ── POST PAGE (individual post with full body) ──
      if (isPost) {
        // Wait for post content to render
        await page
          .waitForSelector(
            '[data-testid="post-content"], shreddit-post, .Post',
            { timeout: 12000 }
          )
          .catch(() => {});

        const postData = await page.evaluate(() => {
          // Title
          const title =
            document
              .querySelector(
                'h1[slot="title"], h1.title, [data-testid="post-title"] h1'
              )
              ?.innerText?.trim() ||
            document.querySelector("h1")?.innerText?.trim() ||
            "";

          // Body text — Reddit new UI uses different selectors
          const body =
            document
              .querySelector(
                '[data-testid="post-content"] [data-click-id="text"] p'
              )
              ?.innerText?.trim() ||
            document.querySelector(".RichTextJSON-root p")?.innerText?.trim() ||
            document.querySelector('[slot="text-body"]')?.innerText?.trim() ||
            document.querySelector(".usertext-body .md")?.innerText?.trim() ||
            "";

          // Score / upvotes
          const scoreEl =
            document.querySelector(
              '[data-testid="vote-arrows"] [id^="vote-arrows"]'
            ) ||
            document.querySelector("faceplate-number[pretty]") ||
            document.querySelector('[data-click-id="upvote"]');
          const score =
            parseInt(
              scoreEl?.innerText || scoreEl?.getAttribute("number") || "0"
            ) || 0;

          // Comment count
          const commentEl = document.querySelector(
            '[data-testid="comments-page-link-num-comments"], a[href*="#comments"] span'
          );
          const comments = parseInt(commentEl?.innerText || "0") || 0;

          return { title, body, score, comments };
        });

        const { title, body, score, comments } = postData;

        // Skip posts with no title
        if (!title) {
          log.warning(`  No title found at ${request.url}`);
          return;
        }

        const fullText = `${title} ${body}`.toLowerCase();
        const matchedKeywords = PAIN_KEYWORDS.filter((kw) =>
          fullText.includes(kw)
        );

        await dataset.pushData({
          sector,
          subreddit: sr,
          title,
          text: body,
          score,
          comments,
          url: request.url,
          matchedKeywords,
          painSignalScore: matchedKeywords.length,
        });

        savedCounts[sr] = (savedCounts[sr] || 0) + 1;

        // Log only pain-signal posts to keep logs clean
        if (matchedKeywords.length > 0) {
          log.info(
            `  ✅ PAIN SIGNAL [${matchedKeywords.join(", ")}] → "${title.slice(
              0,
              60
            )}"`
          );
        }
      }
    },

    failedRequestHandler({ request, log }) {
      log.error(
        `Failed: ${request.url} — ${request.errorMessages?.join(", ")}`
      );
    },
  });

  // Run the crawler across all start URLs
  await crawler.run(startUrls);

  // Print final summary
  console.log("\n📊 Final counts:");
  for (const [sr, count] of Object.entries(savedCounts)) {
    console.log(`  r/${sr}: ${count} posts`);
  }

  console.log("\n✅ Done. Dataset: reddit-pain-points");
  await Actor.exit();
}

main().catch(console.error);
