import { useState } from 'react';
import { X, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';

/* Warm-Pastel 컬러 가이드 (CLAUDE.md §2) — 새 단체 생성 시 권장 팔레트 */
const WARM_PASTEL_PALETTE = [
  { color: '#708A81', lightColor: '#E2ECE9', label: 'Sage Green' },
  { color: '#C97A53', lightColor: '#F5ECE6', label: 'Warm Terracotta' },
  { color: '#6A85B6', lightColor: '#E6ECF5', label: 'Royal Dusk Blue' },
  { color: '#B19470', lightColor: '#F4EFE6', label: 'Bronze Gold' },
  { color: '#889E73', lightColor: '#ECF0E6', label: 'Forest Olive' },
  { color: '#9B72AA', lightColor: '#F2ECF5', label: 'Soft Amethyst' },
  { color: '#82A0D8', lightColor: '#E8EDF5', label: 'Sky Pastel Blue' },
  { color: '#D291BC', lightColor: '#F6ECF2', label: 'Dusk Pink' },
  { color: '#A89B8C', lightColor: '#EEEAE4', label: 'Warm Stone' },
  { color: '#7BA89E', lightColor: '#E5EEEB', label: 'Sea Mist' }
];

export function OrgEditorModal({ org, onClose, onSave, onDelete }) {
  const isNew = !org?.id;
  const isDefault = org?.isDefault === true;
  const [name, setName] = useState(org?.name || '');
  const [color, setColor] = useState(org?.color || WARM_PASTEL_PALETTE[0].color);
  const [lightColor, setLightColor] = useState(org?.lightColor || WARM_PASTEL_PALETTE[0].lightColor);
  const [error, setError] = useState(null);

  const pickPreset = (preset) => {
    if (isDefault) return;
    setColor(preset.color);
    setLightColor(preset.lightColor);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('단체 이름을 입력하세요.'); return; }
    const hex = /^#[0-9A-Fa-f]{6}$/;
    if (!hex.test(color) || !hex.test(lightColor)) {
      setError('컬러는 #RRGGBB 형식이어야 합니다.');
      return;
    }
    onSave({ name: name.trim(), color, lightColor });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: 12 }}>
          <h3 style={{ fontWeight: 700, fontSize: '1.1rem' }}>
            {isNew ? '🆕 새 단체 등록' : isDefault ? '✏️ 기본 단체 편집 (이름만)' : '✏️ 단체 편집'}
          </h3>
          <button type="button" className="btn-icon flex-center" onClick={onClose}><X size={14} /></button>
        </div>

        {error && (
          <div style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', padding: 10, borderRadius: 8, color: 'var(--color-warning)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <div className="form-group">
          <label>단체 이름</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="단체명을 입력하세요" autoFocus required />
        </div>

        {isDefault && (
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', padding: '6px 10px', background: 'var(--color-primary-light)', borderRadius: 6 }}>
            DB에 기본 단체로 등록되어 이름만 편집할 수 있습니다.
          </p>
        )}

        <div className="form-group">
          <label>시그니처 컬러 팔레트 (Warm-Pastel)</label>
          <div className="palette-grid">
            {WARM_PASTEL_PALETTE.map((p, i) => (
              <button
                key={i}
                type="button"
                className={`palette-chip ${color === p.color ? 'active' : ''}`}
                onClick={() => pickPreset(p)}
                disabled={isDefault}
                title={p.label}
                style={{ background: p.color, opacity: isDefault ? 0.5 : 1 }}
              >
                {color === p.color && <CheckCircle2 size={14} color="#fff" />}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>시그니처 HEX</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="text" value={color} onChange={(e) => setColor(e.target.value)} disabled={isDefault} pattern="^#[0-9A-Fa-f]{6}$" />
              <div className="hex-swatch" style={{ background: color }} />
            </div>
          </div>
          <div className="form-group">
            <label>파스텔 배경 HEX</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="text" value={lightColor} onChange={(e) => setLightColor(e.target.value)} disabled={isDefault} pattern="^#[0-9A-Fa-f]{6}$" />
              <div className="hex-swatch" style={{ background: lightColor }} />
            </div>
          </div>
        </div>

        {/* 미리보기 */}
        <div className="org-preview-card" style={{ background: lightColor, borderLeft: `4px solid ${color}` }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color, letterSpacing: 1 }}>PREVIEW</span>
          <h4 style={{ color, fontWeight: 800, fontSize: '1rem' }}>{name || '단체 이름'}</h4>
          <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>이 단체의 캘린더 막대 / 채팅 풍선 / 보고서 헤더에 위 톤이 자동 적용됩니다.</p>
        </div>

        <div className="modal-footer">
          {!isNew && !isDefault && (
            <button type="button" className="btn-secondary" onClick={onDelete} style={{ color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }}>
              <Trash2 size={12} /> 삭제
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary">{isNew ? '등록' : '저장'}</button>
        </div>
      </form>
    </div>
  );
}
