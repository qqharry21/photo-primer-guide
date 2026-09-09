/* 攝影教學技巧指南 — Service Worker
   改了任何 .html / .json 內容檔(index.html、caption.html、tabs.json、
   每個分頁的 manifest.json、每個分頁 chapters 資料夾裡的章節檔案)之後,
   一定要把 VERSION 加一,使用者下次開啟才會拿到新版,不然會一直被
   cache-first 的 RUNTIME 快取卡在舊內容。 */
const VERSION   = 'gr4-v19';
const CORE      = VERSION + '-core';
const RUNTIME   = VERSION + '-runtime';

const CORE_FILES = [
  './',
  './index.html',
  './caption.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CORE)
      .then(function (c) { return c.addAll(CORE_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CORE && k !== RUNTIME) { return caches.delete(k); }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') { self.skipWaiting(); }
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') { return; }
  const url = new URL(req.url);

  // 導覽請求：先試網路，失敗就用快取的頁面（離線可讀）
  //
  // 注意：這裡要用「這個網址自己」當快取的 key。早期只有 index.html 一頁時
  // 是寫死 './index.html'，多一頁之後那樣會出兩個問題——線上瀏覽工具頁會把
  // 工具頁存進指南的 key（污染快取），離線開工具頁又會拿到指南。
  // 存與取都改成跟著實際網址走，並去掉 query 以免同一頁因參數不同重複存。
  if (req.mode === 'navigate') {
    const pageKey = url.origin + url.pathname;
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          // 用 waitUntil 讓 SW 活到寫入完成，這是規範建議的寫法
          e.waitUntil(caches.open(CORE).then(function (c) { return c.put(pageKey, copy); }));
        }
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (r) {
          // 這一頁沒快取到才退回指南首頁，至少不會是一片空白
          return r || caches.match('./index.html', { ignoreSearch: true });
        }).then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  // 同源靜態檔：快取優先
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          const copy = res.clone();
          caches.open(RUNTIME).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  // 字型等跨網域資源：先給快取，同時背景更新
  //
  // 這裡一定要保證最後回傳的是「真的 Response」。字型抓不到時若讓 promise
  // 解析成 undefined，樣式表的請求會一直懸著；而待處理的樣式表會擋住頁尾的
  // inline script，結果就是整頁 JS 都不執行。離線正是字型抓不到的時候，
  // 所以這條路徑壞掉等於 PWA 離線功能整個失效。
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(
      caches.open(RUNTIME).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) { return hit; }
          return fetch(req).then(function (res) {
            if (res && (res.ok || res.type === 'opaque')) { c.put(req, res.clone()); }
            return res;
          }).catch(function () {
            // 樣式表回一份空 CSS，瀏覽器立刻改用系統字型繼續往下跑；
            // 字型檔本身則視為單純失敗，不影響版面。
            if (url.hostname === 'fonts.googleapis.com') {
              return new Response('/* 離線：改用系統字型 */', {
                status: 200, headers: { 'Content-Type': 'text/css' }
              });
            }
            return Response.error();
          });
        });
      })
    );
  }
});
