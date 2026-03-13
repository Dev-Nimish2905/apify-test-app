const { Actor } = require("apify");

async function main() {
  await Actor.init();

  const input = (await Actor.getInput()) || {};
  const subreddits = input.subreddits || ["Entrepreneur"];
  const maxPerSub = input.maxPerSub || 50;
  const sleepMs = input.sleepMs || 1500;

  const dataset = await Actor.openDataset();

  for (const sr of subreddits) {
    let fetched = 0;
    let after = null;

    console.log(`Starting ${sr}`);

    while (fetched < maxPerSub) {
      const limit = Math.min(100, maxPerSub - fetched);
      const url = `https://www.reddit.com/r/${sr}/new.json?limit=${limit}${
        after ? "&after=" + after : ""
      }&raw_json=1`;

      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "apify-ai-startup-research/0.1" },
        });

        if (!res.ok) {
          console.error(`HTTP ${res.status} for r/${sr}, stopping subreddit`);
          break;
        }

        const data = await res.json();
        const posts = data?.data?.children || [];

        if (posts.length === 0) break; // no more posts

        for (const p of posts) {
          const post = p.data;
          await dataset.pushData({
            subreddit: sr,
            title: post.title,
            text: post.selftext,
            score: post.score,
            comments: post.num_comments,
            created: post.created_utc,
          });
        }

        fetched += posts.length;
        after = data.data.after;

        if (!after) break;

        await new Promise((r) => setTimeout(r, sleepMs));
      } catch (err) {
        console.error(`Error fetching r/${sr}:`, err.message);
        break;
      }
    }

    console.log(`Fetched ${fetched} posts from r/${sr}`);
  }

  console.log("Done scraping");
  await Actor.exit();
}

main().catch(console.error);
