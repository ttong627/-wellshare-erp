# 🏛️ WS 회의록 자동 작성 & 통합 예약 시스템 — 프로젝트 룰

> **이 파일은 모든 작업에 우선합니다.** 어떤 산출물을 만들든, 어떤 문서를 수정하든, 시작 전에 이 룰을 확인하고 종료 전에 체크리스트로 검증하십시오.

---

## 0. 대전제 (NEVER violate)

- 본 프로젝트는 **구현 + 기획 병행** 모드입니다 (2026-05-22 결정). 1차 산출물은 React + Vite로 동작하는 **WS 통합 시스템 (src/)** 이며, 4종 기획서([README.md](README.md), [SECURITY_DATABASE.md](SECURITY_DATABASE.md), [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md), [UI_UX_SPEC.md](UI_UX_SPEC.md))는 **구현이 반드시 만족해야 할 사양 기준(Spec Criteria)** 으로 작동합니다.
- 코드 변경 시 반드시 기획서 사양과 일치해야 합니다. 사양과 코드가 충돌하면 **사양이 우선**이며, 사양을 바꿔야 한다면 4종 기획서를 동기 수정한 후 코드를 따라야 합니다.
- 3대 설계 철학 — 3초 직관성 / Classic Warm Minimal / 위협 사전 방어 — 와 어긋나는 제안은 거절하십시오.

---

## 1. 작업 전 / 작업 후 의무 절차

**모든 작업 시작 전:**
1. 해당 작업이 아래 13개 체크리스트 중 어떤 항목과 관련되는지 식별
2. 관련 기획서 섹션을 먼저 읽어 사양 고정값(컬러 HEX, AI 임계값, 코덱 스펙 등) 확인
3. [src/App.jsx](src/App.jsx) / [src/App.css](src/App.css)의 기존 구현 상태 확인

**모든 작업 종료 전:**
1. 아래 13개 체크리스트를 항목별로 검증
2. `npm run dev` 또는 `npm run build`로 코드가 동작하는지 확인
3. 위반 시 사용자에게 명시적으로 보고하고 수정안 제시

**기술 스택 (변경 금지):**
- React 18.3 + Vite 5.2 + lucide-react 아이콘
- 단일 페이지 데모 구조 (현재 App.jsx에 통합)
- **데이터 영속성**: Firestore (Firebase Web SDK 9+) + Anonymous Auth
- **AI 부분만 시뮬레이션 유지**: GCP STT v2, Gemini, OCR은 mock 시나리오. "🎬 시연 전용" 라벨로 명시. 실제 호출은 추후 별도 작업
- **배포**: Cloud Run (asia-northeast3), 서비스명 `WS-web`, 프로젝트 `wellshare-erp`

---

## 2. 절대 준수 체크리스트 (13항목)

### [1] 산출물 형식
- [ ] 코딩 없이 **사양 문서(Markdown)**로 산출했는가
- [ ] 새 기능 추가 시 4종 기획서 중 해당하는 곳에 반영했는가

### [2] 단체 컬러 시스템 ([UI_UX_SPEC.md:29-38](UI_UX_SPEC.md#L29-L38))
- [ ] **9개 기본 단체의 HEX 코드를 시드 데이터로 보존**했는가 (Firestore `organizations` 컬렉션의 시드 값)
  - 경기자활기업협회 `#708A81`/`#E2ECE9` · 경기광역자활센터 `#C97A53`/`#F5ECE6` · 컴윈 `#6A85B6`/`#E6ECF5` · HD협동조합 `#B19470`/`#F4EFE6` · 경기사회서비스사협 `#889E73`/`#ECF0E6` · 웰쉐어사협 `#9B72AA`/`#F2ECF5` · 클린쿱사협 `#82A0D8`/`#E8EDF5` · 웰쉐어로지스 `#D291BC`/`#F6ECF2` · 라윈시스템 `#A89B8C`/`#EEEAE4`
- [ ] 사용자는 **단체 추가/편집** 가능하나, **기본 9개 단체의 컬러는 변경 금지** (시드 무결성)
- [ ] 추가 단체는 Warm-Pastel 톤 가이드(채도 -15%, 헥사 가이드라인 표) 안에서 선택하도록 유도

### [3] 테마 적용 4대 영역 ([UI_UX_SPEC.md:14-22](UI_UX_SPEC.md#L14-L22))
- [ ] 캘린더 타임라인 / STT 채팅 풍선 / AI 요약 헤더 / PDF 템플릿 **4곳 모두**에 단체 테마 적용 명세가 있는가

### [4] 데이터 격리 (Firestore Security Rules)
- [ ] 모든 컬렉션에 `orgId` 기반 행 단위 격리가 적용되는가
- [ ] 회의록 read는 동일 `orgId` 소속만 허용하는가
- [ ] 권한 역할은 `admin` / `manager` / `member` 3종만 사용하는가

### [5] 성문 데이터 보안 ([SECURITY_DATABASE.md:216-223](SECURITY_DATABASE.md#L216-L223))
- [ ] 성문은 **128차원 임베딩 벡터**로만 저장되는가 (원본 음성 저장 금지)
- [ ] `SHA-256/HMAC-Noise` 해시 + 사용자별 Salt + Gaussian Noise를 적용했는가
- [ ] 원본 오디오는 로컬 메모리에서 Zeroing 후 즉시 소멸하는가

### [6] 암호화 정책
- [ ] 전송: **TLS 1.3** 강제 / 저장: **AES-256-GCM** 명시
- [ ] 모든 클라이언트-서버 통신은 HTTPS/WSS만 허용하는가

### [7] 오디오 코덱 ([SYSTEM_ARCHITECTURE.md:55](SYSTEM_ARCHITECTURE.md#L55))
- [ ] **Opus / Ogg / 16kHz / Mono / 24kbps** 고정 사양인가
- [ ] AGC `+18dB`, AI Noise Suppression `-25dB`, AEC 3단 파이프라인이 명시되는가

### [8] AI 임계값 + 4중 검수 (변경 금지)
- [ ] 화자 성문 매칭: **Cosine Similarity 85% 이상**
- [ ] 회의록 자동 종결: **Assurance Score 95% 이상** → 담당자 무개입 + Stitch 자동 배포
- [ ] 95% 미만은 Highlight Focus 구간만 표시 (전체 재검토 강요 금지)
- [ ] 80% 미만 모호 구간은 빨간 경고등 + 10초 클립 재생 버튼만 노출
- [ ] **사후 4중 검수 (Post-Meeting Audit)**: 회의 종료 후 `🔬 4중 검수 실행` 버튼으로 Gemini 1회 추가 호출 → Pass 1 vs Pass 2 diff 패널 (신규 발견·누락 의심·일치 항목 색상 구분) → [Pass 1 유지 / Pass 2 채택 / 병합] 선택 후 확정 ([SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md))

### [9] 데이터 수명주기 ([SYSTEM_ARCHITECTURE.md:209-214](SYSTEM_ARCHITECTURE.md#L209-L214))
- [ ] `archivePolicy.expireAt` = 작성 후 **5년**
- [ ] 만료 시 GCP Cloud Storage Archive Class + BigQuery로 자동 콜드 이관

### [10] 사진 업로드 파이프라인
- [ ] 모바일 에지 단에서 **WebP 1200px / 압축률 80%** 자동 변환
- [ ] 원본 + 썸네일 **2-URL 분리** 저장
- [ ] Cloud Functions ClamAV 안티바이러스 스캔 트리거

### [11] 오프라인 복원력
- [ ] 네트워크 끊김 시 **SQLite + IndexedDB** 로컬 큐 적재
- [ ] Service Worker가 3초 간격 통신 체크 후 자동 재전송 (Stitch 병합)
- [ ] 사용자에게는 빨간 에러가 아닌 **웜-골드 안심 토스트** (`#B19470`) 노출

### [12] 렌더링 성능
- [ ] 캘린더는 **Virtual Scroll(윈도잉)** 강제 — 화면 영역 20~50개만 DOM 렌더
- [ ] STT/OCR 등 외부 AI 모듈에 **Circuit Breaker** 적용 — 장애 격리
- [ ] 로딩 시 차가운 스피너 대신 **웜베이지 스켈레톤 파형**

### [13] UX 어포던스 5종 ([UI_UX_SPEC.md:185-225](UI_UX_SPEC.md#L185-L225))
- [ ] **드래그 앤 드롭 시간 예약** — 날짜/시간 입력 폼 배제
- [ ] **맥락적 플로팅 버튼** — 화면당 최우선 동작 **단 하나**만 (회의 전 → 회의 중 → 회의 종료 상태 진화)
- [ ] **베이지 빗금 사선 패턴** — 예약 불가 영역 (단순 dim 금지)
- [ ] **무접촉 자동 캡처** — 0.8초 고정 시 Auto-Snap
- [ ] **햅틱 + 우드 사운드** — 모든 성공 인터랙션에 물리 피드백

---

## 3. 편의 기능 6종 — 누락 금지 ([UI_UX_SPEC.md:42-86](UI_UX_SPEC.md#L42-L86))

새 기능을 설계하거나 기존 기능을 수정할 때, 다음 6종 중 영향받는 항목이 있는지 확인하십시오:

| # | 기능 | 추천자 | 핵심 |
|---|---|---|---|
| ① | 음성 명령 예약 (Voice Booking) | 미연 | 마이크 길게 눌러 자연어 → 예약 폼 자동 완성 |
| ② | AI 최적 예약 추천 (Smart Scheduler) | 안토니 | 인원수/안건 기반 상위 3개 추천 |
| ③ | 미참석자 5줄 실시간 요약 | 홀리 | 카카오톡/문자 5초 발송 |
| ④ | 타임스탬프 하이라이트 플레이어 | 타미 | `audioOffsetSeconds`로 정확 스킵 |
| ⑤ | PII 자동 마스킹 | 코코 | Gemini가 계좌/주민번호 등 자동 블라인드 |
| ⑥ | 단체별 점유율 대시보드 | 빌 | 월간 이용시간/노쇼 인포그래픽 |

---

## 4. 필수 스키마 필드 (절대 누락 금지)

작성/수정 시 다음 필드가 빠지지 않았는지 확인:

- **organizations**: `theme.primaryColor`, `theme.pastelBgColor`, `stats`
- **users**: `role`, `voiceprint.embeddingVector` (128차원), `voiceprint.hashAlgorithm`
- **reservations**: `orgId`, `semanticHash`, `isVoiceBooked`, `stitchSourceId`
- **meeting_minutes**: `rawTranscript[].audioOffsetSeconds`, `attachedPhotos[].ocrText`, `security.isMasked`, `security.maskedKeywords`, `archivePolicy.expireAt`
- **인덱스**: `room + date + startTime` 복합 인덱스 (중복 예약 검증)

---

## 5. 위반 시 행동 규칙

위 룰을 위반하는 사용자 요청을 받았을 때:

1. **거절하지 말고**, 어떤 룰과 충돌하는지 먼저 명시
2. 기획서 원문 라인 번호를 인용하며 근거 제시
3. 룰을 만족하는 **대안 2~3개**를 제안
4. 사용자가 명시적으로 "룰 무시하고 진행" 지시 시에만 우회

사용자가 룰 자체를 수정하길 원하면, **CLAUDE.md와 원본 기획서 4종 모두 동기 수정**하십시오. 한쪽만 바뀌면 정합성이 깨집니다.

---

## 6. 드림팀 공동 개발 에이전트 목록 (기본 에이전트)

본 프로젝트는 형님(보스)의 리더십 아래 12인의 전담 에이전트가 유기적으로 연동되어 개발 및 관리를 수행합니다. 모든 태스크 수행 시 관련 전문 담당자의 피드백을 반영하십시오.

| 번호 | 이름 | 역할 | 비고 / 전문 영역 |
| :--- | :--- | :--- | :--- |
| **리더** | **형님** | **보스 (Boss)** | **최종 의사결정** |
| 1 | 안토니 | 기획·설계 팀장 | 전체 아키텍처·방향 조율 |
| 2 | 홀리 | UI/UX 디자인 | 프리미엄 디자인·사용성 |
| 3 | 타미 | 신기술·무지연 | Zero-Loading·성능 최적화 |
| 4 | 미아 | 코드 무결성 | 중복 제거·에러 핸들링 |
| 5 | 브루마 | 풀스택 개발 | 구현·성능 최적화 |
| 6 | 빌 | DB 설계·운영 | 쿼리·인덱스·데이터 정합성 |
| 7 | 코코 | 보안 전문가 | 인증·인가·취약점 방어 |
| 8 | 미연 | QA·UX 테스터 | 기능 테스트·엣지케이스 |
| 9 | 에릭 | 빌드 에러 해결사 | build-error-resolver |
| 10 | 도나 | 문서 관리 전담 | doc-updater |
| 11 | 재이 | TDD 전도사 | tdd-guide |
| 12 | 베라 | 검증 파이프라인 | verify-agent |

