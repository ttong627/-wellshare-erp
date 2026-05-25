/* WS Cloud Functions (코코: PII 마스킹 백엔드화)
 * - maskPII: 클라이언트가 전송한 회의록 텍스트의 민감 정보를 서버에서 마스킹
 *   계좌번호, 주민등록번호, 전화번호, 카드번호, 이메일, 예산금액
 *
 * 운영 시 Gemini Pro 호출로 교체 (현재는 정규식 기반 1차 마스킹 + 정합 검증)
 * 배포: firebase deploy --only functions
 * 호출 (client):
 *   import { getFunctions, httpsCallable } from 'firebase/functions';
 *   const fn = httpsCallable(getFunctions(undefined, 'asia-northeast3'), 'maskPII');
 *   const { data } = await fn({ text, dialogues });
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp();
setGlobalOptions({ region: 'asia-northeast3', maxInstances: 10 });

/* ============================================================
 *  PII 정규식 패턴 (한국 기준)
 * ============================================================ */
const PII_PATTERNS = [
  // 주민등록번호 (XXXXXX-XXXXXXX)
  { label: 'rrn', regex: /\b\d{6}[-\s]?[1-4]\d{6}\b/g, mask: '주민등록번호[마스킹]' },
  // 계좌번호 (은행마다 다름, 일반 패턴: 6~14자리 + 하이픈)
  { label: 'account', regex: /\b\d{2,6}-\d{2,8}-\d{2,8}\b/g, mask: '계좌번호[마스킹]' },
  // 휴대전화 (010-XXXX-XXXX)
  { label: 'phone', regex: /\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, mask: '전화번호[마스킹]' },
  // 카드번호 (XXXX-XXXX-XXXX-XXXX)
  { label: 'card', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, mask: '카드번호[마스킹]' },
  // 이메일
  { label: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, mask: '이메일[마스킹]' },
  // 금액 (예: 5000만원, 1억, 100억) — 시연 단계 비활성 가능
  // { label: 'money', regex: /\b\d+(?:,\d{3})*\s*(?:만원|억|천만원|백만원)\b/g, mask: '금액[마스킹]' },
];

function maskText(input) {
  if (typeof input !== 'string') return { masked: input, hits: [] };
  let out = input;
  const hits = [];
  for (const p of PII_PATTERNS) {
    out = out.replace(p.regex, () => {
      hits.push(p.label);
      return p.mask;
    });
  }
  return { masked: out, hits };
}

/* ============================================================
 *  maskPII — 회의록 텍스트 + 대화 배열 일괄 마스킹
 * ============================================================ */
exports.maskPII = onCall(async (request) => {
  const { text, dialogues, minutesId } = request.data || {};

  if (!request.auth) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const result = {
    maskedText: null,
    maskedDialogues: null,
    hits: [],
    processedAt: new Date().toISOString()
  };

  if (typeof text === 'string') {
    const r = maskText(text);
    result.maskedText = r.masked;
    result.hits.push(...r.hits);
  }

  if (Array.isArray(dialogues)) {
    result.maskedDialogues = dialogues.map(d => {
      const r = maskText(d.text || '');
      result.hits.push(...r.hits);
      return { ...d, text: r.masked };
    });
  }

  // 회의록 문서가 있으면 security 필드 업데이트 (감사 추적)
  if (minutesId && result.hits.length > 0) {
    try {
      const db = getFirestore();
      await db.collection('meeting_minutes').doc(minutesId).update({
        'security.isMasked': true,
        'security.maskedKeywords': [...new Set(result.hits)],
        'security.maskedAt': new Date().toISOString(),
        'security.maskedBy': request.auth.uid
      });
    } catch (err) {
      console.warn('[maskPII] minutes update failed:', err.message);
    }
  }

  return {
    success: true,
    hitCount: result.hits.length,
    uniqueLabels: [...new Set(result.hits)],
    ...result
  };
});

/* ============================================================
 *  healthCheck — 함수 가용성 확인용
 * ============================================================ */
exports.healthCheck = onCall(async () => {
  return {
    ok: true,
    region: 'asia-northeast3',
    timestamp: new Date().toISOString(),
    runtime: 'nodejs20'
  };
});
