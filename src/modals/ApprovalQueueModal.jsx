import { UserCheck, X } from 'lucide-react';

export function ApprovalQueueModal({ pendingUsers, orgs, isAdmin, onApprove, onReject, onPromoteManager, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: 12 }}>
          <h3 style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserCheck size={18} /> 가입 승인 대기 ({pendingUsers.length}명)
          </h3>
          <button className="btn-icon flex-center" onClick={onClose}><X size={14} /></button>
        </div>

        {pendingUsers.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>승인 대기 인원이 없습니다.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingUsers.map((u) => {
              const org = orgs.find((o) => o.id === u.orgId);
              return (
                <div key={u.id} className="approval-row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{u.displayName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{u.email} · {u.position || '직책 미입력'}</div>
                    {org && (
                      <span className="badge" style={{ backgroundColor: org.lightColor, color: org.color, fontSize: '0.65rem', marginTop: 2 }}>
                        {org.name}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button className="btn-primary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => onApprove(u.id)}>✓ 승인</button>
                    {isAdmin && (
                      <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem', borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }} onClick={() => onPromoteManager(u.id)}>매니저로</button>
                    )}
                    <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem', color: 'var(--color-warning)' }} onClick={() => onReject(u.id, u.displayName)}>거절</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
