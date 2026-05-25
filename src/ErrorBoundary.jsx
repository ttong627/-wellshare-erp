import { Component } from 'react';

/* React 19 미만에서 화이트스크린 방지용 ErrorBoundary
 * 한 컴포넌트 에러가 전체 앱을 깨는 것을 막고, 사용자에게 복구 옵션 제공 */
export class ErrorBoundary extends Component {
  state = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error('[ErrorBoundary]', error, info?.componentStack);
    // Sentry 등 모니터링 SDK 연동 (환경변수 VITE_SENTRY_DSN 설정 시 활성화)
    if (window.Sentry) {
      window.Sentry.captureException(error, { contexts: { react: { componentStack: info?.componentStack } } });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: null });
  };

  handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F7F4EF',
        padding: 24,
        fontFamily: 'Outfit, "Noto Sans KR", sans-serif',
      }}>
        <div style={{
          maxWidth: 520,
          background: '#fff',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 8px 24px rgba(30, 23, 16, 0.08)',
          textAlign: 'center',
          border: '1px solid rgba(60, 51, 42, 0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontWeight: 800, marginBottom: 8, color: '#1E1710' }}>
            예기치 못한 오류가 발생했습니다
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#7E7265', marginBottom: 16 }}>
            화면 한 부분에 문제가 생겼지만 데이터는 안전합니다.
            <br />아래 버튼으로 복구하거나 새로고침해 보세요.
          </p>

          {this.state.error && (
            <details style={{
              background: '#F7F4EF',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              textAlign: 'left',
              fontSize: '0.78rem',
              color: '#3C332A',
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>기술 정보 (개발용)</summary>
              <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.72rem' }}>
                {String(this.state.error?.message || this.state.error)}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={this.handleReset}
              style={{
                background: 'transparent',
                color: '#3C332A',
                border: '1px solid rgba(177, 148, 112, 0.3)',
                padding: '10px 20px',
                borderRadius: 8,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >다시 시도</button>
            <button
              onClick={this.handleHardReload}
              style={{
                background: '#B19470',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 8,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >새로고침</button>
          </div>
        </div>
      </div>
    );
  }
}
