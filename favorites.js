/* 攝影教學技巧指南 — 收藏功能(單人跨裝置同步)
   本機用 localStorage 存一份完整清單,當作「隨時可用、離線也能操作」的主資料;
   有設定 Gist 的話,額外把同一份資料同步到一個私人 GitHub Gist,當作跨裝置的
   共同真相來源。合併策略是「加法聯集 + 刪除墓碑」——夠單人輕量使用,不需要
   完整 CRDT。

   對外只透過 window.Fav 這個物件溝通,index.html 的內嵌 script 呼叫這裡的
   function 來讀寫收藏、判斷某個章節/小節目前是否已收藏、訂閱資料變動事件
   來重繪 UI。這支檔案完全不碰 DOM,只管資料跟同步。 */
(function (global) {
  'use strict';

  var GIST_FILENAME = 'favorites.json';
  var TOMBSTONE_TTL_MS = 60 * 24 * 3600 * 1000; // 60 天:早該同步過了,可以清掉
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
  function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function readJSON(key, fallback) {
    try { return JSON.parse(lsGet(key, null)); } catch (e) { return fallback; }
  }

  /* ---------- key:唯一識別一筆收藏 ---------- */
  function keyOf(type, tab, file, sectionId) {
    return type + ':' + tab + ':' + file + (sectionId ? (':' + sectionId) : '');
  }

  /* ---------- 本機資料存取 ---------- */
  function loadLocal() {
    return {
      items: readJSON('fav.items', []) || [],
      tombstones: readJSON('fav.tombstones', []) || []
    };
  }
  function saveLocal(items, tombstones) {
    lsSet('fav.items', JSON.stringify(items));
    lsSet('fav.tombstones', JSON.stringify(tombstones));
  }
  function markDirty() { lsSet('fav.dirty', '1'); }
  function clearDirty() { lsRemove('fav.dirty'); }
  function isDirty() { return lsGet('fav.dirty', null) === '1'; }

  /* ---------- 事件:資料一變動就通知 UI 重繪 ---------- */
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emitChange() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* ---------- 同步狀態(給面板顯示用) ---------- */
  var status = { state: 'idle', error: null }; // idle | syncing | error
  function setStatus(state, error) {
    status = { state: state, error: error || null };
    emitChange();
  }
  function getStatus() {
    if (!getPat() || !getGistId()) { return { state: 'unconfigured' }; }
    if (!navigator.onLine) { return { state: 'offline', dirty: isDirty() }; }
    return { state: status.state, error: status.error, dirty: isDirty() };
  }
  function getLastSyncedAt() {
    var v = lsGet('fav.lastSyncedAt', null);
    return v ? +v : null;
  }
  function setLastSynced(ts) { lsSet('fav.lastSyncedAt', String(ts)); }

  function formatRelative(ts) {
    if (!ts) { return '尚未同步過'; }
    var diff = Date.now() - ts;
    if (diff < 45 * 1000) { return '剛剛'; }
    var min = Math.round(diff / 60000);
    if (min < 60) { return min + ' 分鐘前'; }
    var hr = Math.round(min / 60);
    if (hr < 24) { return hr + ' 小時前'; }
    var day = Math.round(hr / 24);
    return day + ' 天前';
  }

  /* ---------- 憑證(PAT + Gist ID) ---------- */
  function getPat() { return lsGet('fav.pat', ''); }
  function getGistId() { return lsGet('fav.gistId', ''); }
  function setCredentials(pat, gistId) {
    if (pat != null) { lsSet('fav.pat', pat); }
    if (gistId != null) { lsSet('fav.gistId', gistId); }
    emitChange();
  }
  function clearCredentials() {
    lsRemove('fav.pat'); lsRemove('fav.gistId');
    setStatus('idle');
  }

  /* ---------- 收藏/取消收藏 ---------- */
  function toggleByKey(key, makeItem) {
    var data = loadLocal();
    var idx = -1;
    for (var i = 0; i < data.items.length; i++) { if (data.items[i].key === key) { idx = i; break; } }
    var nowFav;
    if (idx >= 0) {
      data.items.splice(idx, 1);
      data.tombstones = data.tombstones.filter(function (t) { return t.key !== key; });
      data.tombstones.push({ key: key, deletedAt: Date.now() });
      nowFav = false;
    } else {
      data.items.push(makeItem());
      data.tombstones = data.tombstones.filter(function (t) { return t.key !== key; });
      nowFav = true;
    }
    saveLocal(data.items, data.tombstones);
    markDirty();
    emitChange();
    scheduleSync();
    return nowFav;
  }

  function toggleChapter(tab, file, chapterTitle) {
    var key = keyOf('chapter', tab, file);
    return toggleByKey(key, function () {
      return { key: key, type: 'chapter', tab: tab, file: file, chapterTitle: chapterTitle, addedAt: Date.now() };
    });
  }

  function toggleSection(tab, file, sectionId, chapterTitle, sectionTitle) {
    var key = keyOf('section', tab, file, sectionId);
    return toggleByKey(key, function () {
      return {
        key: key, type: 'section', tab: tab, file: file, sectionId: sectionId,
        chapterTitle: chapterTitle, sectionTitle: sectionTitle, addedAt: Date.now()
      };
    });
  }

  function removeByKey(key) {
    var data = loadLocal();
    var idx = -1;
    for (var i = 0; i < data.items.length; i++) { if (data.items[i].key === key) { idx = i; break; } }
    if (idx < 0) { return; }
    data.items.splice(idx, 1);
    data.tombstones = data.tombstones.filter(function (t) { return t.key !== key; });
    data.tombstones.push({ key: key, deletedAt: Date.now() });
    saveLocal(data.items, data.tombstones);
    markDirty();
    emitChange();
    scheduleSync();
  }

  function isChapterFav(tab, file) {
    var key = keyOf('chapter', tab, file);
    return loadLocal().items.some(function (i) { return i.key === key; });
  }
  function isSectionFav(tab, file, sectionId) {
    var key = keyOf('section', tab, file, sectionId);
    return loadLocal().items.some(function (i) { return i.key === key; });
  }
  function list() {
    return loadLocal().items.slice().sort(function (a, b) { return b.addedAt - a.addedAt; });
  }

  /* ---------- 合併:加法聯集 + 刪除墓碑 ---------- */
  function mergeData(local, remote) {
    var itemMap = {};
    (remote.items || []).forEach(function (it) { itemMap[it.key] = it; });
    (local.items || []).forEach(function (it) {
      var ex = itemMap[it.key];
      if (!ex || it.addedAt >= ex.addedAt) { itemMap[it.key] = it; }
    });

    var tombMap = {};
    (remote.tombstones || []).forEach(function (t) { tombMap[t.key] = t; });
    (local.tombstones || []).forEach(function (t) {
      var ex = tombMap[t.key];
      if (!ex || t.deletedAt >= ex.deletedAt) { tombMap[t.key] = t; }
    });

    // 同一個 key 同時有收藏跟刪除墓碑時,比時間戳決定誰贏
    Object.keys(tombMap).forEach(function (key) {
      var tomb = tombMap[key], item = itemMap[key];
      if (item) {
        if (item.addedAt > tomb.deletedAt) { delete tombMap[key]; }
        else { delete itemMap[key]; }
      }
    });

    var cutoff = Date.now() - TOMBSTONE_TTL_MS;
    var tombstones = Object.keys(tombMap).map(function (k) { return tombMap[k]; })
      .filter(function (t) { return t.deletedAt >= cutoff; });
    var items = Object.keys(itemMap).map(function (k) { return itemMap[k]; });
    return { items: items, tombstones: tombstones };
  }

  /* ---------- GitHub Gist API ---------- */
  function apiHeaders(pat) {
    return { 'Authorization': 'token ' + pat, 'Accept': 'application/vnd.github+json' };
  }
  function friendlyError(err, status) {
    if (status === 401) { return '同步失敗:令牌無效或已過期'; }
    if (status === 404) { return '同步失敗:找不到這個 Gist,請確認 Gist ID'; }
    if (status) { return '同步失敗:GitHub 回應 ' + status; }
    return '同步失敗:離線或網路錯誤';
  }
  function fetchGist(gistId, pat) {
    return fetch('https://api.github.com/gists/' + gistId, { headers: apiHeaders(pat) })
      .then(function (r) {
        if (!r.ok) { var e = new Error(friendlyError(null, r.status)); e.status = r.status; throw e; }
        return r.json();
      })
      .then(function (g) {
        var f = g.files && g.files[GIST_FILENAME];
        if (!f || !f.content) { return { items: [], tombstones: [] }; }
        try { return JSON.parse(f.content); } catch (e) { return { items: [], tombstones: [] }; }
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
      if (!r.ok) { var e = new Error(friendlyError(null, r.status)); e.status = r.status; throw e; }
      return r.json();
    });
  }
  function createGist(pat) {
    var initial = { items: [], tombstones: [] };
    var headers = apiHeaders(pat);
    headers['Content-Type'] = 'application/json';
    var files = {};
    files[GIST_FILENAME] = { content: JSON.stringify(initial) };
    return fetch('https://api.github.com/gists', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ description: '攝影教學技巧指南 - 收藏清單', public: false, files: files })
    }).then(function (r) {
      if (!r.ok) { var e = new Error(friendlyError(null, r.status)); e.status = r.status; throw e; }
      return r.json();
    }).then(function (g) { return g.id; });
  }

  /* ---------- 同步流程 ---------- */
  var syncing = false;
  var syncPromise = null;
  var syncDebounceTimer = null;

  function syncNow() {
    var pat = getPat(), gistId = getGistId();
    if (!pat || !gistId) { return Promise.resolve({ skipped: true, reason: 'unconfigured' }); }
    if (!navigator.onLine) { return Promise.resolve({ skipped: true, reason: 'offline' }); }
    if (syncing) { return syncPromise; }

    syncing = true;
    setStatus('syncing');
    syncPromise = fetchGist(gistId, pat).then(function (remote) {
      var local = loadLocal();
      var merged = mergeData(local, remote);
      saveLocal(merged.items, merged.tombstones);
      emitChange();
      return writeGist(gistId, pat, merged);
    }).then(function () {
      clearDirty();
      setLastSynced(Date.now());
      setStatus('idle');
      return { ok: true };
    }).catch(function (err) {
      setStatus('error', err && err.message);
      throw err;
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
    emitChange(); // 先用本機資料把 UI 畫出來,不等網路
    if (navigator.onLine) { syncNow().catch(function () {}); }
  }

  global.Fav = {
    init: init,
    isChapterFav: isChapterFav,
    isSectionFav: isSectionFav,
    toggleChapter: toggleChapter,
    toggleSection: toggleSection,
    removeByKey: removeByKey,
    list: list,
    onChange: onChange,
    getStatus: getStatus,
    getLastSyncedAt: getLastSyncedAt,
    formatRelative: formatRelative,
    getPat: getPat,
    getGistId: getGistId,
    setCredentials: setCredentials,
    clearCredentials: clearCredentials,
    createGist: createGist,
    syncNow: syncNow
  };
})(window);
