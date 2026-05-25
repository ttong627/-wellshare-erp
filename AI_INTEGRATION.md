# 🧠 AI 실연동 로드맵 (Phase 4.1)

> 현재 코드의 STT / Gemini / OCR 부분은 모두 mock 시나리오입니다. 본 문서는 실제 GCP API로 교체하는 단계별 작업 계획입니다.

## 📐 아키텍처 — Hybrid C 모드 (SYSTEM_ARCHITECTURE.md §0 결정)

```
[모바일 단말]
  ├─ 녹음 + AGC/AEC/Noise Suppression (RNNoise WebAssembly)
  ├─ Opus 인코딩 (Web Codecs API or opus-recorder lib)
  └─ 회의 종료 시 Cloud Storage 직접 업로드 (signed URL)
        ↓
[Cloud Functions / Cloud Run 백엔드]
  ├─ /api/stt — GCP Speech-to-Text v2 batch 호출 → Firestore meeting_minutes에 transcript 저장
  ├─ /api/summarize — Gemini 1.5 Pro 호출 → brief + decisions + actionItems 생성
  ├─ /api/audit — 4중 검수용 Gemini 재호출 → Pass 2 diff
  └─ /api/ocr — GCP Document AI 호출 (회의 안내장 자동 셋업)
        ↓
[Firestore meeting_minutes/{id}]
  ├─ rawTranscript[], aiSummary, attachedPhotos[], security.isMasked, archivePolicy.expireAt
  └─ (CLAUDE.md §4 필수 필드 모두 채워짐)
```

## 🛠 구현 단계

### Step 1: 백엔드 프로젝트 셋업 (4-6시간)
```bash
mkdir backend && cd backend
npm init -y
npm install @google-cloud/speech @google-cloud/vertexai @google-cloud/storage express cors firebase-admin
```

- `index.js` Express 서버 (Cloud Run에 별도 배포)
- 서비스 계정 키 (`gcloud iam service-accounts keys create ...`)
- IAM 역할: `roles/speech.client`, `roles/aiplatform.user`, `roles/storage.objectAdmin`

### Step 2: STT 엔드포인트 (3시간)
```js
const speech = require('@google-cloud/speech').v2;
const client = new speech.SpeechClient();

app.post('/api/stt', async (req, res) => {
  const { gcsUri, orgId } = req.body;
  const [operation] = await client.batchRecognize({
    recognizer: `projects/${PROJECT}/locations/asia-northeast3/recognizers/_`,
    config: {
      autoDecodingConfig: {},
      model: 'telephony',
      languageCodes: ['ko-KR'],
      features: {
        enableAutomaticPunctuation: true,
        diarizationConfig: { minSpeakerCount: 2, maxSpeakerCount: 8 },
      },
    },
    files: [{ uri: gcsUri }],
    recognitionOutputConfig: { inlineResponseConfig: {} },
  });
  const [response] = await operation.promise();
  res.json(response);
});
```

### Step 3: Gemini 요약 엔드포인트 (2시간)
```js
const { VertexAI } = require('@google-cloud/vertexai');
const vertex = new VertexAI({ project: PROJECT, location: 'asia-northeast3' });
const model = vertex.getGenerativeModel({ model: 'gemini-1.5-pro' });

app.post('/api/summarize', async (req, res) => {
  const { transcript, metadata } = req.body;
  const prompt = buildSummaryPrompt(transcript, metadata); // SYSTEM_ARCHITECTURE.md §2-⑤ 프롬프트
  const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
  res.json(JSON.parse(result.response.text()));
});
```

### Step 4: 클라이언트 연동 (3시간)
- App.jsx에 진짜 녹음 (MediaRecorder API) — mobile sim 부활
- Cloud Storage 직접 업로드 (Firebase Storage SDK or signed URL)
- 백엔드 API 호출
- Firestore meeting_minutes 실제 저장
- 4중 검수 두 번째 호출

### Step 5: meeting_minutes Firestore Rules + Indexes
```
match /meeting_minutes/{id} {
  allow read: if isMemberOf(resource.data.orgId);
  allow create: if isMember() && request.resource.data.orgId == userOrgId();
  allow update, delete: if resource.data.creatorUid == request.auth.uid || isManagerOf(resource.data.orgId);
}
```

### Step 6: 5년 TTL 자동 콜드 이관 (Cloud Scheduler + Cloud Function)
- Cron: 매일 03:00
- 쿼리: `archivePolicy.expireAt <= now()` → GCS Archive Class로 이관 → 원본 삭제

## 💰 예상 비용 (2시간 회의 1건 기준)
- Cloud Storage 업로드: $0.003
- STT v2 batch: $1.92 (0.016/분 × 120분)
- Gemini 1.5 Pro 요약 (입력 25k + 출력 2k): $0.04
- 4중 검수 1회 추가: $0.05
- **총 약 $2 (≈ 2,700원)** — 월 50건 가정 시 월 $100 (~14만원)

## ⏱ 예상 작업 시간
- Step 1-3 백엔드: 1-2일
- Step 4 클라이언트 연동: 1일
- Step 5-6 운영 인프라: 0.5일
- 통합 테스트 + 디버깅: 1일
- **합계 약 3-4일 풀타임 작업**

## 🔐 보안 체크리스트
- [ ] 서비스 계정 키 절대 클라이언트 노출 금지
- [ ] 백엔드 Cloud Run에 Identity-Aware Proxy 또는 Firebase Auth 토큰 검증
- [ ] CORS 화이트리스트 (frontend 도메인만)
- [ ] Cloud Storage 버킷 비공개, signed URL TTL 짧게 (5분)
- [ ] STT 결과 Firestore 저장 시 PII 마스킹 후 저장
