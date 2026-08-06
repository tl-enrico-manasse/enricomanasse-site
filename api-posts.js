// api/posts.js — Vercel Edge Function
//
// Fetches Enrico's Substack RSS feed server-side and returns JSON,
// avoiding third-party CORS proxies and CORS restrictions in the browser.
//
// After deploying, the site's /api/posts endpoint returns the latest
// posts. If this endpoint is unavailable, the site falls back to a
// public CORS proxy automatically.

export const config = { runtime: 'edge' };

const FEED = 'https://emanax.substack.com/feed';
const MAX_ITEMS = 25;
const CACHE = 'public, s-maxage=600, stale-while-revalidate=1800';

const SECURITY_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': CACHE,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ posts: [] }), {
      status: 405,
      headers: { ...SECURITY_HEADERS, allow: 'GET, HEAD' },
    });
  }

  try {
    const upstream = await fetch(FEED, {
      headers: {
        'user-agent': 'enrico-manasse-site/1.0 (+https://enricomanasse.com)',
        accept: 'application/rss+xml, application/xml, text/xml',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) throw new Error('upstream ' + upstream.status);

    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('xml')) throw new Error('unexpected content-type');

    const xml = await upstream.text();
    if (xml.length > 2_000_000) throw new Error('feed too large');

    const posts = parseFeed(xml).slice(0, MAX_ITEMS);

    return new Response(JSON.stringify({ posts }), {
      status: 200,
      headers: SECURITY_HEADERS,
    });
  } catch (_err) {
    // Never leak internal errors to the client.
    return new Response(JSON.stringify({ posts: [] }), {
      status: 200,
      headers: SECURITY_HEADERS,
    });
  }
}

// Minimal, tolerant RSS parser. Substack's feed is well-formed.
function parseFeed(xml) {
  const items = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    const body = chunk.split(/<\/item>/i)[0];
    items.push({
      title: extract(body, 'title'),
      link: extract(body, 'link'),
      date: extract(body, 'pubDate'),
      body: extract(body, 'content:encoded'),
    });
  }
  return items;
}

function extract(source, tag) {
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const match = source.match(re);
  if (!match) return '';
  return match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}
