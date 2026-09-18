/* 攝影教學技巧指南 — 閱讀進度(單人跨裝置同步)
   記住「每個章節」讀到哪個小節,以及全站最後讀到的那一個,永久存在本機
   localStorage;若已經在收藏功能設定過同步(見 favorites.js),就額外借用
   同一組 Token + Gist,把進度多存一個檔案(progress.json)一起同步——不
   需要另外設定一次。合併策略是「每個章節各自比 updatedAt,新的贏」,
   沒有刪除墓碑的必要(進度只會被覆寫,不會被移除)。

   對外只透過 window.Progress 這個物件溝通,index.html 的內嵌 script 呼叫
   這裡的 function 來記錄/讀取閱讀進度。這支檔案完全不碰 DOM,只管資料跟
   同步。 */
(function (global) {
  'use strict';

  var GIST_FILENAME = 'progress.json';
  var SYNC_DEBOUNCE_MS = 1500;

  /* ---------- 小工具:localStorage 包一層,避免私密模式/儲存空間滿了直接炸掉 ---------- */
  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }
  function readJSON(key, fallback) {
    try { return JSON.parse(lsGet(key, null)); } catch (e) { return fallback; }
  }

  function keyOf(tab, file) { return tab + ':' + file; }

  /* ---------- 本機資料存取:{ "<tab>:<file>": {tab,file,chapterTitle,sectionId,sectionTitle,updatedAt} } ---------- */
  function loadLocal() { return readJSON('rp.positions', {}) || {}; }
  function saveLocal(positions) { lsSet('rp.positions', JSON.stringify(positions)); }
  function markDirty() { lsSet('rp.dirty', '1'); }
  function clearDirty() { try { localStorage.removeItem('rp.dirty'); } catch (e) {} }
  function isDirty() { return lsGet('rp.dirty', null) === '1'; }

  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emitChange() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  /* ---------- 記錄/讀取進度 ---------- */
  function record(tab, file, chapterTitle, sectionId, sectionTitle) {
    if (!tab || !file) { return; }
    var positions = loadLocal();
    var key = keyOf(tab, file);
    var existing = positions[key];
    // 同一章節裡,只往前推進的時間戳才算數,避免舊分頁殘留的計時器蓋掉新資料
    positions[key] = {
      tab: tab, file: file, chapterTitle: chapterTitle || (existing && existing.chapterTitle) || '',
      sectionId: sectionId || null, sectionTitle: sectionTitle || null,
      updatedAt: Date.now()
    };
    saveLocal(positions);
    markDirty();
    scheduleSync();
  }

  function getPosition(tab, file) {
    var positions = loadLocal();
    return positions[keyOf(tab, file)] || null;
  }

  function getLatest() {
    var positions = loadLocal();
    var best = null;
    Object.keys(positions).forEach(function (k) {
      var p = positions[k];
      if (!best || p.updatedAt > best.updatedAt) { best = p; }
    });
    return best;
  }

  /* ---------- 合併:每個 key 各自比 updatedAt,新的贏 ---------- */
  function mergeData(local, remote) {
    var merged = {};
    Object.keys(remote || {}).forEach(function (k) { merged[k] = remote[k]; });
    Object.keys(local || {}).forEach(function (k) {
      var ex = merged[k];
      if (!ex || local[k].updatedAt >= ex.updatedAt) { merged[k] = local[k]; }
    });
    return merged;
  }

  /* ---------- 同步憑證:直接借用收藏功能存的同一組 Token + Gist ID ---------- */
  function getPat() { return lsGet('fav.pat', ''); }
  function getGistId() { return lsGet('fav.gistId', ''); }

  function apiHeaders(pat) {
    return { 'Authorization': 'token ' + pat, 'Accept': 'application/vnd.github+json' };
  }
  function fetchGist(gistId, pat) {
    return fetch('https://api.github.com/gists/' + gistId, { headers: apiHeaders(pat) })
      .then(function (r) {
        if (!r.ok) { var e = new Error('sync failed: ' + r.status); e.status = r.status; throw e; }
        return r.json();
      })
      .then(function (g) {
        var f = g.files && g.files[GIST_FILENAME];
        if (!f || !f.content) { return {}; }
        try { return JSON.parse(f.content); } catch (e) { return {}; }
      });
  }
  function writeGist(gistId, pat, data) {
    var body = { files: {} };
    body.files[GIST_FILENAME] = { content: JSON.stringify(data) };
    var headers = apiHeaders(pat);
    headers['Content-Type'] = 'application/json';
    return fetch('https://api.github.com/gists/' + gistId, {
      method: 'PATCH', headers: headers, body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) { var e = new Error('sync failed: ' + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }

  /* ---------- 同步流程(跟收藏功能共用同一個 Gist,只是多寫一個檔案進去) ---------- */
  var syncing = false;
  var syncPromise = null;
  var syncDebounceTimer = null;

  function syncNow() {
    var pat = getPat(), gistId = getGistId();
    if (!pat || !gistId) { return Promise.resolve({ skipped: true, reason: 'unconfigured' }); }
    if (!navigator.onLine) { return Promise.resolve({ skipped: true, reason: 'offline' }); }
    if (syncing) { return syncPromise; }

    syncing = true;
    syncPromise = fetchGist(gistId, pat).then(function (remote) {
      var local = loadLocal();
      var merged = mergeData(local, remote);
      saveLocal(merged);
      emitChange();
      return writeGist(gistId, pat, merged);
    }).then(function () {
      clearDirty();
      return { ok: true };
    }).then(
      function (r) { syncing = false; return r; },
      function (err) { syncing = false; throw err; }
    );
    return syncPromise;
  }

  function scheduleSync() {
    if (syncDebounceTimer) { clearTimeout(syncDebounceTimer); }
    syncDebounceTimer = setTimeout(function () {
      syncNow().catch(function () {});
    }, SYNC_DEBOUNCE_MS);
  }

  global.addEventListener('online', function () { syncNow().catch(function () {}); });

  function init() {
    if (navigator.onLine) { syncNow().catch(function () {}); }
  }

  global.Progress = {
    init: init,
    record: record,
    getPosition: getPosition,
    getLatest: getLatest,
    syncNow: syncNow
  };
})(window);
