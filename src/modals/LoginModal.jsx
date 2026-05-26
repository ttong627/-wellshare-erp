import { useState } from 'react';
import { X } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, signInWithGoogle, sendPasswordReset, isWebView } from '../firebase.js';

const SITE_URL = 'https://wellshare-erp.web.app';

function openInExternalBrowser() {
  const ua = navigator.userAgent || '';
  const target = window.location.href || SITE_URL;
  if (/Android/i.test(ua)) {
    // Android: Intent URL로 Chrome 강제 실행
    const host = window.location.host;
    const path = window.location.pathname + window.location.search + window.location.hash;
    window.location.href = `intent://${host}${path}#Intent;scheme=https;package=com.android.chrome;end`;
  } else {
    // iOS: 클립보드에 URL 복사 후 안내
    navigator.clipboard?.writeText(target).catch(() => {});
    alert(`Safari 주소창에 아래 URL을 붙여넣기 하세요:\n${target}`);
  }
}

export function LoginModal({ mode, onSwitchMode, onClose, onSuccess, onError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [webViewBlocked, setWebViewBlocked] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'signin') await signInWithEmail(email, password);
      else await signUpWithEmail(email, password, displayName || email.split('@')[0]);
      onSuccess();
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential' ? '이메일/비밀번호가 올바르지 않습니다.'
        : err.code === 'auth/email-already-in-use' ? '이미 등록된 이메일입니다.'
        : err.code === 'auth/weak-password' ? '비밀번호는 6자 이상이어야 합니다.'
        : err.message;
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    // WebView 감지 — Google OAuth 차단 환경
    if (isWebView()) {
      setWebViewBlocked(true);
      return;
    }
    setSubmitting(true);
    try {
      const result = await signInWithGoogle();
      // result === null → 모바일 redirect (페이지 이동, initAuth가 재진입 시 처리)
      // result !== null → 데스크톱 popup 성공
      if (result) onSuccess();
    } catch (err) {
      const msg = err.code === 'auth/popup-closed-by-user' ? '로그인 창이 닫혔습니다.'
        : err.code === 'auth/operation-not-allowed' ? 'Google 로그인이 콘솔에서 활성화되지 않았습니다. (Firebase Console → Authentication → Sign-in method → Google → 사용)'
        : err.message;
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // WebView 차단 안내 화면
  if (webViewBlocked) {
    const isAndroid = /Android/i.test(navigator.userAgent || '');
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content auth-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', padding: 28 }}>
          <button type="button" className="btn-icon flex-center" onClick={onClose}
            style={{ position: 'absolute', top: 16, right: 16 }}>
            <X size={14} />
          </button>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🌐</div>
          <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 }}>
            외부 브라우저에서 열어주세요
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            카카오톡·네이버 등 인앱 브라우저에서는<br />
            Google 로그인 정책으로 인해 접근이 차단됩니다.<br />
            {isAndroid ? 'Chrome' : 'Safari'}에서 열면 정상 로그인됩니다.
          </p>
          <button
            type="button"
            className="google-signin-btn"
            onClick={openInExternalBrowser}
            style={{ marginBottom: 10 }}
          >
            {isAndroid ? '🟢 Chrome에서 열기' : '🔵 Safari에서 URL 복사'}
          </button>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 8 }}>
            {SITE_URL}
          </div>
          <div style={{ marginTop: 16 }}>
            <strong style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              또는 이메일/비밀번호로 로그인하세요 ↓
            </strong>
          </div>
          <button type="button" className="btn-secondary" style={{ marginTop: 10, width: '100%' }}
            onClick={() => setWebViewBlocked(false)}>
            이메일로 로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content auth-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: 12 }}>
          <h3 style={{ fontWeight: 700, fontSize: '1.1rem' }}>
            {mode === 'signin' ? '🔐 로그인' : '✨ 회원가입'}
          </h3>
          <button type="button" className="btn-icon flex-center" onClick={onClose}><X size={14} /></button>
        </div>

        <button type="button" className="google-signin-btn" onClick={handleGoogle} disabled={submitting}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
          Google로 {mode === 'signin' ? '로그인' : '시작하기'}
        </button>

        <div className="auth-divider"><span>또는 이메일</span></div>

        {mode === 'signup' && (
          <div className="form-group">
            <label>이름 (회의록에 표시)</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="홍길동" />
          </div>
        )}
        <div className="form-group">
          <label>이메일</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="form-group">
          <label>비밀번호 {mode === 'signup' && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>(6자 이상)</span>}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 6 : 1} />
          {mode === 'signin' && (
            <button
              type="button"
              onClick={async () => {
                if (!email) { onError('이메일을 먼저 입력해 주세요.'); return; }
                try {
                  await sendPasswordReset(email);
                  onError('비밀번호 재설정 메일이 발송되었습니다. 메일함을 확인해 주세요.');
                } catch (err) {
                  onError('재설정 실패: ' + (err.code === 'auth/user-not-found' ? '등록되지 않은 이메일' : err.message));
                }
              }}
              style={{
                background: 'transparent', border: 'none', color: 'var(--color-primary)',
                fontSize: '0.72rem', textDecoration: 'underline', cursor: 'pointer',
                padding: '4px 0 0 0', textAlign: 'left'
              }}
            >비밀번호를 잊으셨나요? 재설정 메일 보내기</button>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={() => onSwitchMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? '회원가입 →' : '← 로그인'}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? '처리 중...' : (mode === 'signin' ? '로그인' : '가입 신청')}
          </button>
        </div>
      </form>
    </div>
  );
}
