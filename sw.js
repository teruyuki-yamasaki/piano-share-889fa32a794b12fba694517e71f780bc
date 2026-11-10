/**
 * Service Worker（スマートフォン版をオフラインでも開けるように）。js/app/mobile.js が静的なホスティングのときだけ登録する。
 *  - インストール時: precache.json（tools/build-static.mjs が作る、アプリのファイルの一覧）をすべて端末に入れる
 *  - 取得: まずネットから（新しい版をすぐ使う）。つながらなければ端末に入れたものを返す
 * VERSION は tools/build-static.mjs が中身のハッシュに書き換える。sw.js の中身が変わるとブラウザが新しい版として入れ直し、
 * 新しい一式を入れて古いものを消す（デプロイし直すと自動で更新される）。
 * 注意: MIDIWeb Browser などアプリ内のブラウザ（WKWebView）では Service Worker が動かないことが多い。そのときは毎回ネットから読む。
 */
const PREFIX = 'score-companion-';
const VERSION = "23e17ed012d4";
const CACHE = PREFIX + VERSION;

async function manifest() {
  const res = await fetch('./precache.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('precache.json がありません');
  return res.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const { files } = await manifest();
      const cache = await caches.open(CACHE);
      await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        // 開いたファイルは端末にも入れておく（一覧にないもの: 次の版で増えたファイルなど）
        if (res.ok && res.type === 'basic') {
          const copy = res.clone(); // ページに返す前に複製する（返したあとでは中身が読まれている）
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        // ページそのもの（./ や ./?…）は index.html で代わりに
        if (req.mode === 'navigate') {
          const index = await caches.match('./index.html');
          if (index) return index;
        }
        throw err;
      }
    })(),
  );
});
