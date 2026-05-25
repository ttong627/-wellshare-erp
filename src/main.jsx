import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          {/* / → 웹 데스크톱 / /m → 모바일 예약 / /notes → 모바일 회의록 작성
           * (Chrome Safe Browsing이 1글자 경로 /r 을 피싱 의심으로 차단해서 /notes 로 변경) */}
          <Route path="/" element={<App entry="web" />} />
          <Route path="/m" element={<App entry="m-book" />} />
          <Route path="/notes" element={<App entry="m-minutes" />} />
          <Route path="/r" element={<Navigate to="/notes" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)

/* Service Worker 등록 — PWA / TWA 자격을 위한 필수 조건 (offline-first 큐 포함)
 * 개발 모드에서는 등록하지 않음 (HMR 충돌 방지) */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });

    /* 브루마: SW로부터 재전송 결과 알림 받음 — App.jsx의 window CustomEvent로 전달 */
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (msg.type === 'WS_QUEUE_PROCESSED') {
        const { succeeded, failed, remaining } = msg;
        if (failed > 0) {
          window.dispatchEvent(new CustomEvent('ws-queue-failure', {
            detail: { succeeded, failed, remaining }
          }));
        } else if (succeeded > 0) {
          window.dispatchEvent(new CustomEvent('ws-queue-success', {
            detail: { succeeded }
          }));
        }
      }
    });

    /* 온라인 복귀 시 자동 sync 트리거 */
    window.addEventListener('online', async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg.sync) await reg.sync.register('ws-stitch-sync');
      } catch (err) {
        console.warn('Sync registration failed:', err);
      }
    });
  });
}
