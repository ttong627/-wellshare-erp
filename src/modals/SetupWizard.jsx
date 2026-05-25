import { useState } from 'react';

export function SetupWizard({ user, orgs, onComplete }) {
  const isInitialAdmin = (user.email || '').toLowerCase() === 'ttong627@gmail.com';
  const [orgId, setOrgId] = useState(orgs[0]?.id || '');
  const [position, setPosition] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onComplete({ orgId: isInitialAdmin ? null : orgId, position });
  };

  return (
    <div className="modal-overlay">
      <form className="modal-content auth-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 style={{ fontWeight: 700, fontSize: '1.1rem', textAlign: 'center' }}>
          👋 환영합니다, {user.displayName || user.email}님
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>
          {isInitialAdmin
            ? '관리자 권한으로 자동 활성화됩니다. 단체 정보는 선택 사항입니다.'
            : '소속 단체를 선택하면 매니저의 승인 후 활성화됩니다.'}
        </p>

        {isInitialAdmin && (
          <div style={{ background: 'var(--color-success-bg)', border: '1px solid var(--color-success)', padding: 10, borderRadius: 8, color: 'var(--color-success)', fontSize: '0.78rem', fontWeight: 600, textAlign: 'center' }}>
            ⭐ INITIAL_ADMIN — 자동 관리자 권한 부여
          </div>
        )}

        {!isInitialAdmin && (
          <div className="form-group">
            <label>소속 단체</label>
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}

        <div className="form-group">
          <label>직책 (선택)</label>
          <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="회장, 총무, 서기 등" />
        </div>

        <div className="modal-footer" style={{ justifyContent: 'center' }}>
          <button type="submit" className="btn-primary">{isInitialAdmin ? '관리자 시작' : '가입 신청'}</button>
        </div>
      </form>
    </div>
  );
}
