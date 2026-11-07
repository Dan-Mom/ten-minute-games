/* Chinese lessons offline (2026-11-07): lets a Chinese lesson open and play with no internet, once it was opened online.
 * Published at the site root (zh-sw.js), so it can also keep the home page and the book pages (how a child gets to a lesson).
 *
 * What it does, and nothing more:
 * - Only these addresses: the home page, chinese/book-*.html, games/chinese/**, and the web fonts the pages use. Every other
 *   game is never answered from here (a game with its own service worker in its own folder is controlled by that one).
 * - Recordings, old drawings and stroke files never change under the same name (a changed line gets a new file), so they come
 *   from the cache first. Pages and the other files come from the internet first, but after 3 s without an answer (Wi-Fi
 *   with no internet) the kept copy is used, so a child never waits long.
 * - Lesson files are added to the cache only by the lesson itself when it opens (the engine, LESSON.offline), so a lesson is
 *   kept whole or not at all. Here, files under games/chinese/ are only refreshed when they are already kept; the home page,
 *   the book pages and the fonts are kept as they come.
 * - With no internet, a page that is not kept gets a small page with a Home button instead of the browser's error page
 *   (in the home-screen app there is no back button).
 * - Only its own cache (CACHE) is ever touched. <audio> asks for parts of a recording (Range); those are cut from the kept file.
 */
const CACHE = 'zh-offline';
const ROOT = new URL('./', self.location.href).pathname;            // the site root, e.g. /ten-minute-games/

function rel(url) { return url.pathname.slice(ROOT.length); }
function ours(url) {
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf(ROOT) !== 0) return false;
    const r = rel(url);
    return r === '' || r === 'index.html' || /^chinese\/book-\d+\.html$/.test(r) || r.indexOf('games/chinese/') === 0;
  }
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}
function fixed(url) { return url.origin !== self.location.origin || /\.(mp3|svg)$/.test(url.pathname) || /\/strokes\/[0-9a-f]+\.json$/.test(url.pathname); }
function key(url) { return url.origin === self.location.origin ? url.origin + (rel(url) === '' ? url.pathname + 'index.html' : url.pathname) : url.href; }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function fromCache(req, k) {
  const c = await caches.open(CACHE);
  const hit = await c.match(k);
  if (!hit) return null;
  const range = req.headers.get('range');
  if (!range || hit.type === 'opaque') return hit;
  const m = /bytes=(\d*)-(\d*)/.exec(range), buf = await hit.arrayBuffer(), size = buf.byteLength;
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - +m[2]); end = size - 1; }   // "bytes=-500": the last 500
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}
function keep(e, url, k, res) {   // put a good answer in the cache (lesson files only when that file is kept already)
  if (!res || !(res.ok || res.type === 'opaque') || res.status === 206) return;
  const copy = res.clone(), lesson = url.origin === self.location.origin && rel(url).indexOf('games/chinese/') === 0;
  const job = caches.open(CACHE).then((c) => (lesson ? c.match(k) : Promise.resolve(true)).then((had) => { if (had) return c.put(k, copy); })).catch(() => {});
  try { e.waitUntil(job); } catch (err) {}   // the answer may already have gone out (the 3 s cut-off); the save still runs
}
function noNet() {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No internet</title>'
    + '<body style="font:700 24px system-ui,sans-serif;text-align:center;padding:48px 16px;background:#eef6ff;color:#1d2b4f">📶 This game needs the internet.<br>这个游戏需要网络。<br><br>'
    + '<a href="' + ROOT + '" style="display:inline-block;font-size:28px;padding:12px 28px;border-radius:16px;background:#1b6fd1;color:#fff;text-decoration:none">🏠 Home</a></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!ours(url)) {   // not ours: left alone, except that a page with no internet gets the small Home page
    if (req.mode === 'navigate' && url.origin === self.location.origin && url.pathname.indexOf(ROOT) === 0) e.respondWith(fetch(req).catch(noNet));
    return;
  }
  const k = key(url);
  if (fixed(url)) {   // recordings, drawings, strokes, fonts: the kept copy first
    e.respondWith(fromCache(req, k).then((hit) => hit || fetch(req).then((res) => { if (!req.headers.get('range')) keep(e, url, k, res); return res; })));
    return;
  }
  const net = fetch(req).then((res) => { if (!req.headers.get('range')) keep(e, url, k, res); return res; });
  e.respondWith(new Promise((done) => {
    let over = false;
    const fin = (r) => { if (!over && r) { over = true; done(r); } };
    const slow = setTimeout(() => fromCache(req, k).then(fin), 3000);   // Wi-Fi with no internet: do not keep the child waiting
    net.then((r) => { clearTimeout(slow); if (r.ok || r.status === 206) fin(r); else fromCache(req, k).then((h) => fin(h || r)); },
      () => { clearTimeout(slow); fromCache(req, k).then((h) => fin(h || (req.mode === 'navigate' ? noNet() : Response.error()))); });
  }));
});
