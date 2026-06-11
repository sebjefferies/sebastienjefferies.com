// Cloudflare Worker (Workers + Static Assets)
// Serves the static site, and handles /api/videos by fetching:
//  - Seb's YouTube RSS feed -> "videos" (latest uploads, 16:9 only)
//  - A curated "start here" list -> "curated" (16:9 only)
//  - The channel's "Videos" tab sorted by popularity -> "popular" (16:9 only)
//  - The channel's "Shorts" tab -> "shorts" (9:16 vertical clips)
//
// YouTube Shorts (9:16 vertical videos) are filtered out of the
// "videos", "curated" and "popular" lists via an oEmbed dimension check.

const CHANNEL_ID = "UCqcCVUAeQg90KQknq7H-7uA";
const CHANNEL_HANDLE = "SebastienJefferies";
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const MAX_VIDEOS = 12;
const MAX_POPULAR = 8;
const MAX_SHORTS = 12;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "CONSENT=YES+1",
};

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
    const [videos, curated, popular, shorts] = await Promise.all([
      getLatest(),
      getCurated(),
      getPopular(),
      getShorts(),
    ]);

    return jsonResponse({ videos, curated, popular, shorts });
  } catch (err) {
    return jsonResponse({ videos: [], curated: [], popular: [], shorts: [], error: "unexpected_error" });
  }
}

// ===== Latest uploads (RSS feed), 16:9 only =====
async function getLatest() {
  try {
    const res = await fetch(FEED_URL, {
      cf: { cacheTtl: 1800, cacheEverything: true },
      headers: { "User-Agent": "Mozilla/5.0 (compatible; sebastienjefferies.com video feed)" },
    });
    if (!res.ok) return [];

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

    return await filterOutShorts(parsed);
  } catch {
    return [];
  }
}

// ===== Curated "start here" list, 16:9 only =====
async function getCurated() {
  try {
    const list = CURATED.map((v) => ({
      id: v.id,
      title: v.title,
      link: `https://www.youtube.com/watch?v=${v.id}`,
      thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      published: "",
    }));
    return await filterOutShorts(list);
  } catch {
    return [];
  }
}

// ===== Most popular videos (channel "Videos" tab sorted by popularity), 16:9 only =====
async function getPopular() {
  try {
    const url = `https://www.youtube.com/@${CHANNEL_HANDLE}/videos?view=0&sort=p&flow=grid&hl=en&gl=US`;
    const res = await fetch(url, {
      cf: { cacheTtl: 21600, cacheEverything: true },
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return [];

    const html = await res.text();
    const data = extractYtInitialData(html);
    if (!data) return [];

    const renderers = findAll(data, "videoRenderer");
    const parsed = renderers
      .slice(0, MAX_POPULAR)
      .map((v) => {
        const videoId = v.videoId;
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || "";
        const thumbs = v.thumbnail?.thumbnails || [];
        const thumbnail = thumbs.length
          ? thumbs[thumbs.length - 1].url
          : videoId
          ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          : "";

        return {
          id: videoId,
          title,
          link: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
          thumbnail,
          published: "",
        };
      })
      .filter((v) => v.id);

    return await filterOutShorts(parsed);
  } catch {
    return [];
  }
}

// ===== Quick videos (recent Shorts from the channel "Shorts" tab), 9:16 =====
async function getShorts() {
  try {
    const url = `https://www.youtube.com/@${CHANNEL_HANDLE}/shorts?hl=en&gl=US`;
    const res = await fetch(url, {
      cf: { cacheTtl: 21600, cacheEverything: true },
      headers: BROWSER_HEADERS,
    });
    if (!res.ok) return [];

    const html = await res.text();
    const data = extractYtInitialData(html);
    if (!data) return [];

    const renderers = findAll(data, "reelItemRenderer");
    return renderers
      .slice(0, MAX_SHORTS)
      .map((v) => {
        const videoId = v.videoId;
        const title =
          v.headline?.simpleText ||
          v.headline?.runs?.[0]?.text ||
          v.accessibility?.accessibilityData?.label ||
          "";
        const thumbs = v.thumbnail?.thumbnails || [];
        const thumbnail = thumbs.length
          ? thumbs[thumbs.length - 1].url
          : videoId
          ? `https://i.ytimg.com/vi/${videoId}/oardefault.jpg`
          : "";

        return {
          id: videoId,
          title,
          link: videoId ? `https://www.youtube.com/shorts/${videoId}` : "",
          thumbnail,
          published: "",
        };
      })
      .filter((v) => v.id);
  } catch {
    return [];
  }
}

// Filters a list of {id,...} videos, removing any that are YouTube Shorts.
async function filterOutShorts(list) {
  const flags = await Promise.all(list.map((v) => isShort(v.id)));
  return list.filter((_, i) => !flags[i]);
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

// Recursively collects every value found under the given key name
// anywhere in a (possibly huge) nested object/array, e.g. every
// "videoRenderer" or "reelItemRenderer" in YouTube's ytInitialData.
function findAll(obj, key, results = []) {
  if (!obj || typeof obj !== "object") return results;
  if (Object.prototype.hasOwnProperty.call(obj, key)) results.push(obj[key]);
  for (const k in obj) {
    const val = obj[k];
    if (val && typeof val === "object") findAll(val, key, results);
  }
  return results;
}

function extractYtInitialData(html) {
  const m =
    html.match(/var ytInitialData\s*=\s*(\{.*?\});<\/script>/s) ||
    html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s) ||
    html.match(/ytInitialData\s*=\s*(\{.*?\});/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
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
