// Cloudflare Worker (Workers + Static Assets)
// Serves the static site, and handles /api/videos by fetching
// Seb's YouTube RSS feed (latest uploads) plus a curated "start here"
// list, returning both as JSON. YouTube Shorts (9:16 vertical videos)
// are filtered out of both lists via an oEmbed dimension check.

const FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=UCqcCVUAeQg90KQknq7H-7uA";
const MAX_VIDEOS = 16;

// Curated "Start here" list, pulled from Seb's video list.
const CURATED = [
  { id: "6LhkvHfpjAY", title: "This Is How To Use Google Veo 3 Like A PRO: JSON Prompt (The Only Guide You Need)" },
  { id: "wf7XQ_Rj-I4", title: "How To Create AI Videos That Actually Look Like YOU (The Only Guide You Need)" },
  { id: "q8XuH_R83f0", title: "AI Video Editing Tools You NEED in 2025" },
  { id: "6dQb8EqfTLs", title: "The Ultimate Guide to Making a Talking AI Clone That Looks Just Like You" },
  { id: "C_-vaKslwvg", title: "IT'S OVER: This New AI Can Copy Anyone's Face in Video" },
  { id: "HTBfxEqDCdU", title: "This Is How To Use Kling 3.0 Like A PRO (The Only Guide You Need)" },
  { id: "Utono2euM24", title: "Kling Motion Control 3.0 Full Tutorial Create ANY Character in ANY Scene." },
  { id: "gvzqXageWPc", title: "Nano Banana Pro Just Broke the INTERNET (The Only Guide You Need)" },
  { id: "GODh8WBP124", title: "How To Make Viral VFX Videos With Higgsfield AI" },
  { id: "hWPMN6PQ0dY", title: "Google's Nano Banana Is INSANE (3 Tools You NEED + 10 Use Cases)" },
  { id: "7Kow9fOXHVc", title: "How To Use Your Voice In Google VEO 3: IMAGE to VIDEO (FAST)" },
  { id: "c-CZZi9dyIU", title: "Seedance 2.0 is FINALLY HERE and It's INSANE (The Only Guide You Need)" },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/videos") {
      return handleVideos();
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleVideos() {
  try {
    let videos = [];

    const res = await fetch(FEED_URL, {
      cf: { cacheTtl: 1800, cacheEverything: true },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; sebastienjefferies.com video feed)" },
    });

    if (res.ok) {
      const xml = await res.text();
      const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);

      const parsed = entries
        .slice(0, MAX_VIDEOS)
        .map((entry) => {
          const videoId = match(entry, /<yt:videoId>(.*?)<\/yt:videoId>/);
          const title = decodeEntities(match(entry, /<title>([\s\S]*?)<\/title>/));
          const published = match(entry, /<published>(.*?)<\/published>/);
          const thumbnail =
            match(entry, /<media:thumbnail url="(.*?)"/) ||
            (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "");

          return {
            id: videoId,
            title,
            link: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
            thumbnail,
            published,
          };
        })
        .filter((v) => v.id);

      // Filter out YouTube Shorts (9:16 vertical videos) - keep 16:9 only.
      const flags = await Promise.all(parsed.map((v) => isShort(v.id)));
      videos = parsed.filter((_, i) => !flags[i]);
    }

    // Curated "start here" list - also filtered for Shorts.
    const curatedFlags = await Promise.all(CURATED.map((v) => isShort(v.id)));
    const curated = CURATED.filter((_, i) => !curatedFlags[i]).map((v) => ({
      id: v.id,
      title: v.title,
      link: `https://www.youtube.com/watch?v=${v.id}`,
      thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      published: "",
    }));

    return jsonResponse({ videos, curated });
  } catch (err) {
    return jsonResponse({ videos: [], curated: [], error: "unexpected_error" });
  }
}

// Uses YouTube's oEmbed endpoint to check the embed dimensions.
// Shorts (9:16) report a taller-than-wide embed; regular 16:9
// videos report wider-than-tall.
async function isShort(videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;

    const r = await fetch(oembedUrl, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return false;

    const d = await r.json();
    const width = Number(d.width);
    const height = Number(d.height);
    if (!width || !height) return false;

    return height > width;
  } catch {
    return false;
  }
}

function match(str, regex) {
  const m = str.match(regex);
  return m ? m[1] : "";
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=1800",
    },
  });
}
