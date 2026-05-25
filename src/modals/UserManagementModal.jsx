import { useState } from 'react';
import { Users, X, Trash2 } from 'lucide-react';

export function UserManagementModal({ users, orgs, currentUid, onClose, onChangeOrg, onChangeRole, onChangePosition, onSoftDelete, onToggleMinutesAccess }) {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');

  const filtered = users.filter(u => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${u.displayName || ''} ${u.email || ''} ${u.position || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const handlePositionEdit = (uid, current) => {
    const next = window.prompt('새 직책을 입력하세요', current || '');
    if (next === null) return;
    onChangePosition(uid, next.trim());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content user-mgmt-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: 12 }}>
          <h3 style={{ fontWeight: 700, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={18} color="var(--color-primary)" /> 사용자 관리 ({users.length}명)
          </h3>
          <button className="btn-icon flex-center" onClick={onClose}><X size={14} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="이름 / 이메일 / 직책 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--color-primary-border)', borderRadius: 6, fontSize: '0.85rem' }}
          />
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--color-primary-border)', borderRadius: 6, fontSize: '0.85rem' }}>
            <option value="all">전체 권한</option>
            <option value="admin">관리자</option>
            <option value="manager">매니저</option>
            <option value="member">멤버</option>
            <option value="pending">승인 대기</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-muted)' }}>해당 사용자가 없습니다.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="user-mgmt-table">
              <thead>
                <tr><th>사용자</th><th>단체</th><th>권한</th><th>회의록</th><th>직책</th><th>작업</th></tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const org = orgs.find(o => o.id === u.orgId);
                  const isSelf = u.id === currentUid;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {u.photoURL ? <img src={u.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700 }}>{(u.displayName || '?')[0]}</div>}
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{u.displayName} {isSelf && <span style={{ fontSize: '0.65rem', color: 'var(--color-primary)' }}>(나)</span>}</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{u.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select value={u.orgId || ''} onChange={(e) => onChangeOrg(u.id, e.target.value || null)} style={{ padding: '4px 6px', fontSize: '0.78rem', maxWidth: 140 }}>
                          <option value="">— (없음)</option>
                          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                        {org && <div style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: org.color, marginLeft: 6, verticalAlign: 'middle' }} />}
                      </td>
                      <td>
                        <select value={u.role || 'member'} onChange={(e) => onChangeRole(u.id, e.target.value)} disabled={isSelf} style={{ padding: '4px 6px', fontSize: '0.78rem' }} title={isSelf ? '본인 권한은 변경 불가' : ''}>
                          <option value="admin">관리자</option>
                          <option value="manager">매니저</option>
                          <option value="member">멤버</option>
                          <option value="pending">대기</option>
                        </select>
                      </td>
                      <td>
                        {u.role === 'admin' ? (
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }} title="관리자는 항상 회의록 사용 가능">자동 허용</span>
                        ) : (
                          (() => {
                            const allowed = u.minutesAccess === 'approved';
                            return (
                              <button
                                type="button"
                                className={allowed ? 'btn-primary' : 'btn-secondary'}
                                style={{ padding: '3px 10px', fontSize: '0.7rem', minWidth: 64 }}
                                title={allowed ? '회의록 사용 승인 회수' : '회의록 사용 승인'}
                                onClick={() => onToggleMinutesAccess(u.id, u.displayName, !allowed)}
                              >
                                {allowed ? '✓ 승인됨' : '승인하기'}
                              </button>
                            );
                          })()
                        )}
                      </td>
                      <td>
                        <button type="button" className="btn-secondary" style={{ padding: '3px 8px', fontSize: '0.7rem' }} onClick={() => handlePositionEdit(u.id, u.position)}>
                          {u.position || <span style={{ color: 'var(--color-text-muted)' }}>편집</span>}
                        </button>
                      </td>
                      <td>
                        <button type="button" className="btn-secondary" disabled={isSelf} onClick={() => onSoftDelete(u.id, u.displayName)} style={{ padding: '3px 8px', fontSize: '0.7rem', color: 'var(--color-warning)', borderColor: 'rgba(201, 122, 83, 0.3)' }} title={isSelf ? '본인 삭제 불가' : '추방 (이력 보존)'}>
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', padding: '8px 12px', background: 'var(--bg-canvas)', borderRadius: 6 }}>
          💡 추방(소프트 삭제): 사용자 계정은 비활성화되지만 그가 작성한 예약·회의록은 그대로 유지됩니다 (creator 이름은 시점 캡처).
        </div>
      </div>
    </div>
  );
}
