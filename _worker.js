// Cloudflare Worker (Workers + Static Assets)
// Serves the static site, and handles /api/videos by fetching
// Seb's YouTube RSS feed and returning the latest uploads as JSON.

const FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=UCqcCVUAeQg90KQknq7H-7uA";
const MAX_VIDEOS = 15;

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
    const res = await fetch(FEED_URL, {
      cf: { cacheTtl: 1800, cacheEverything: true },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; sebastienjefferies.com video feed)" },
    });

    if (!res.ok) {
      return jsonResponse({ videos: [], error: `feed_fetch_failed_${res.status}` });
    }

    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);

    const videos = entries
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

    return jsonResponse({ videos });
  } catch (err) {
    return jsonResponse({ videos: [], error: "unexpected_error" });
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
