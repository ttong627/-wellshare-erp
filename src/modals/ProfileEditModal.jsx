import { useState } from 'react';
import { X } from 'lucide-react';

export function ProfileEditModal({ profile, onClose, onSave }) {
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [position, setPosition] = useState(profile.position || '');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave({ displayName, position }); }} style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: 12 }}>
          <h3 style={{ fontWeight: 700, fontSize: '1.05rem' }}>👤 내 프로필 편집</h3>
          <button type="button" className="btn-icon flex-center" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="form-group">
          <label>이메일 (수정 불가)</label>
          <input type="email" value={profile.email || ''} disabled style={{ background: 'var(--bg-canvas)' }} />
        </div>

        <div className="form-group">
          <label>이름 (회의록 표시명)</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>직책</label>
          <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="회장 / 총무 / 서기 등" />
        </div>

        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', padding: '6px 10px', background: 'var(--bg-canvas)', borderRadius: 6 }}>
          소속 단체와 권한은 매니저/admin이 변경할 수 있습니다.
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary">저장</button>
        </div>
      </form>
    </div>
  );
}
