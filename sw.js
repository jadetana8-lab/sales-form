// ===================================================================
// Service Worker — ทำให้เปิดฟอร์มได้แม้เน็ตหลุดชั่วคราว (แคชแค่ตัวหน้าเว็บ)
// การส่ง/ดึงข้อมูลจริง (Google Apps Script) ยังต้องใช้เน็ตตามปกติ
// service worker นี้ไม่ยุ่งกับคำขอไปหา API เลย ปล่อยให้วิ่งตรงเสมอ
// ===================================================================

const CACHE_NAME = 'sales-form-cache-v3';
const APP_SHELL = [
  './login.html',
  './dashboard.html',
  './sales_form_v2.html',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ปล่อยคำขอไป Google Apps Script / โดเมนอื่น (ข้อมูลจริง) วิ่งตรงเสมอ ไม่แคช
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // ไฟล์ในเว็บเอง (HTML/manifest/ไอคอน): ใช้แคชก่อนถ้ามี พร้อมอัปเดตแคชใหม่เงียบๆ เบื้องหลัง
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
