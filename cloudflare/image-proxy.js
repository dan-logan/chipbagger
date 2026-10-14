// Cloudflare Worker serving bag photos from Firebase Storage at https://img.chipbagger.fun/<folder>/<file>.
// Some ad blockers block firebasestorage.googleapis.com outright; this domain isn't on their lists.
// Setup steps are in README.md ("Photo relay on Cloudflare").
const BUCKET = 'chipbagger-abdd3.firebasestorage.app';
const CACHE_SECONDS = 30 * 24 * 60 * 60;

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(request.url);
    // Only the public folders (the same ones storage.rules lets anyone read).
    const m = /^\/(bags|thumbs)\/([^/]+)$/.exec(url.pathname);
    let file;
    try { file = m && decodeURIComponent(m[2]); } catch { file = null; }
    if (!file) return new Response('Not found', { status: 404 });

    const cache = caches.default;
    const key = new Request(`${url.origin}${url.pathname}`);
    const hit = await cache.match(key);
    if (hit) return hit;

    const source = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`${m[1]}/${file}`)}?alt=media`;
    const upstream = await fetch(source);
    if (!upstream.ok) return new Response('Not found', { status: upstream.status === 404 || upstream.status === 403 ? 404 : 502 });

    const headers = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
    });
    const etag = upstream.headers.get('ETag');
    if (etag) headers.set('ETag', etag);
    const response = new Response(upstream.body, { status: 200, headers });
    ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  },
};
