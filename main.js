const Apify = require("apify");
const fetch = require("node-fetch");

Apify.main(async () => {
  const input = (await Apify.getInput()) || {};
  const subreddits = input.subreddits || ["Entrepreneur"];
  const maxPerSub = input.maxPerSub || 50;
  const sleepMs = input.sleepMs || 1500;
  const dataset = await Apify.openDataset();

  const kvStore = await Apify.openKeyValueStore();
  const lastFetch = (await kvStore.getValue("last_fetch")) || {};

  for (const sr of subreddits) {
    let fetched = 0;
    let after = null;
    console.log(`Starting ${sr}`);
    while (fetched < maxPerSub) {
      const limit = Math.min(100, maxPerSub - fetched);
      const url = `https://www.reddit.com/r/${sr}/new.json?limit=${limit}${
        after ? "&after=" + after : ""
      }&raw_json=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "apify-reddit-lite/0.1" },
      });
      if (res.status !== 200) {
        console.warn("HTTP", res.status, "for", url);
        break;
      }
      const data = await res.json();
      const posts = data.data.children || [];
      if (posts.length === 0) break;
      for (const p of posts) {
        const post = p.data;
        // Skip old posts if we have last fetched timestamp for this subreddit
        if (lastFetch[sr] && post.created_utc <= lastFetch[sr]) continue;
        await dataset.pushData({
          fetched_at: new Date().toISOString(),
          subreddit: sr,
          id: post.id,
          title: post.title,
          selftext: post.selftext,
          score: post.score,
          num_comments: post.num_comments,
          created_utc: post.created_utc,
          permalink: post.permalink,
          url: post.url,
          awards: post.total_awards_received,
        });
      }
      fetched += posts.length;
      after = data.data.after;
      if (!after) break;
      await new Promise((r) => setTimeout(r, sleepMs + Math.random() * 300));
    }
    // update lastFetch for subreddit to now (or max created_utc encountered)
    lastFetch[sr] = Math.floor(Date.now() / 1000);
    await kvStore.setValue("last_fetch", lastFetch);
  }
  console.log("Done");
});
