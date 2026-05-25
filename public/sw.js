/* WS Service Worker — Offline-First 큐 (브루마: 재전송 실패 보존 강화)
 * - 정적 자산: stale-while-revalidate
 * - HTML: network-first (최신 버전 우선, 오프라인 시 캐시 fallback)
 * - 신호 복구 시 자동 Stitch 재전송 + 실패 시 사용자에게 postMessage 알림 */

const CACHE_NAME = 'ws-v3';
const DB_NAME = 'ws-offline-queue';
const STORE_NAME = 'pending';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.svg',
  '/icon-512.svg'
];

/* ============================================================
 *  IndexedDB 헬퍼 — 영구 큐 (네트워크 복구 후 재전송 + 실패 보존)
 * ============================================================ */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('status', 'status'); // pending | failed
        store.createIndex('attempts', 'attempts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function markStatus(id, status, errMsg) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return resolve(false);
      item.status = status;
      item.attempts = (item.attempts || 0) + 1;
      item.lastAttemptAt = Date.now();
      if (errMsg) item.lastError = errMsg;
      store.put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

async function deleteItem(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach(c => c.postMessage(message));
}

/* ============================================================
 *  Install / Activate
 * ============================================================ */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ============================================================
 *  Fetch — HTML network-first / 정적 stale-while-revalidate
 * ============================================================ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* ============================================================
 *  Background Sync — 신호 복구 시 자동 Stitch 재전송
 *  실패 시 IndexedDB에 status='failed'로 보존 + 클라이언트 postMessage 알림
 * ============================================================ */
self.addEventListener('sync', (event) => {
  if (event.tag === 'ws-stitch-sync') {
    event.waitUntil(processPendingQueue());
  }
});

async function processPendingQueue() {
  const items = await listPending();
  const pending = items.filter(i => i.status === 'pending' || i.status === 'failed');
  if (pending.length === 0) {
    await notifyClients({ type: 'WS_QUEUE_EMPTY' });
    return;
  }

  let succeeded = 0;
  let failed = 0;
  for (const item of pending) {
    try {
      // 실제 운영: item.endpoint + item.body로 fetch 재전송
      const res = await fetch(item.endpoint || '/api/echo', {
        method: item.method || 'POST',
        headers: { 'Content-Type': 'application/json', ...(item.headers || {}) },
        body: JSON.stringify(item.body || {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await deleteItem(item.id);
      succeeded++;
    } catch (err) {
      // 재전송 실패 — 영구 보존 + attempts 카운트 + 사용자 알림
      const maxAttempts = item.maxAttempts || 5;
      if ((item.attempts || 0) + 1 >= maxAttempts) {
        await markStatus(item.id, 'failed', `${err.message} (max attempts)`);
      } else {
        await markStatus(item.id, 'pending', err.message);
      }
      failed++;
    }
  }
  await notifyClients({
    type: 'WS_QUEUE_PROCESSED',
    succeeded,
    failed,
    remaining: pending.length - succeeded
  });
}

/* ============================================================
 *  메시지 채널 — 클라이언트가 직접 큐 작업 요청 가능
 *  client.postMessage({ type: 'WS_ENQUEUE', payload: {...} })
 * ============================================================ */
self.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'WS_ENQUEUE') {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add({
        ...msg.payload,
        status: 'pending',
        attempts: 0,
        createdAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    event.ports[0]?.postMessage({ ok: true });
  }

  if (msg.type === 'WS_LIST_QUEUE') {
    const items = await listPending();
    event.ports[0]?.postMessage({ items });
  }

  if (msg.type === 'WS_RETRY_FAILED') {
    await processPendingQueue();
    event.ports[0]?.postMessage({ ok: true });
  }

  if (msg.type === 'WS_DELETE_QUEUE_ITEM') {
    await deleteItem(msg.id);
    event.ports[0]?.postMessage({ ok: true });
  }
});
