# 🏛️ WS 회의록 자동 작성 & 통합 예약 시스템 기획 백서

> **"세계 최고 수준의 지능형 예약 및 AI 회의 자동화 서비스 설계를 위한 종합 기획/아키텍처 스펙 포트폴리오"**

본 프로젝트는 **기획 백서 + 실행 가능한 React 시각화 시스템**을 함께 산출하는 통합 워크스페이스입니다 (2026-05-22 운영 모드 전환). 4종 기획서는 구현이 반드시 만족해야 할 **사양 기준(Spec Criteria)** 으로 작동하며, [src/](src/)의 React 코드는 그 사양을 손에 잡히게 시각화하는 **동작 데모**입니다.

형님의 지시에 따라 에이전트 연합팀이 각 전문 분야(아키텍처, UI/UX, 성능, 보안, 데이터)에서 분석한 최고 사양의 기획 백서 시리즈와, 이를 충실히 구현한 시각화 데모가 본 저장소에 체계적으로 수립되어 있습니다.

### 실행 방법
```bash
npm install
npm run dev      # 개발 서버 (Vite)
npm run build    # 프로덕션 빌드
```

### 룰 정합성
모든 변경은 [CLAUDE.md](CLAUDE.md)의 **13항목 절대 준수 체크리스트**를 통과해야 합니다.

---

## 📂 기획 백서 시리즈 구성 (Document Map)

형님이 원하시는 사양을 바로 확인하실 수 있도록 기획서를 도메인별로 세분화하여 설계했습니다. 아래 링크를 통해 완벽히 고도화된 기획을 검토해 보세요.

### 1. 🏛️ [기획 핵심 설계서 (implementation_plan.md)](file:///C:/Users/ttong/.gemini/antigravity-ide/brain/6e6268e1-e3cf-4982-b9a5-c37c81bb04eb/implementation_plan.md)
* 실시간 STT 피드, Focus DND 차단, 녹음 끊김 비상 사이렌, AI 동일 회의 중복 예약 방지 등 형님이 직접 피드백 주신 **핵심 고도화 요구사항의 최종 설계 청사진**입니다.

### 2. 🎨 [UI/UX 화면 흐름 상세 사양서 (UI_UX_SPEC.md)](file:///d:/TTong_Projects/mdpj/UI_UX_SPEC.md)
* **Classic Warm Minimal** 테마 가이드라인.
* 9개 기본 단체 캘린더 및 즉시 예약 상태 레이아웃 설계.
* 모바일 WS 앱의 3단계 흐름(OCR 카메라 스캔, 실시간 진행형 STT 및 DND 활성화, 요약 리포트 전달).
* **상태별 화면 정의**: DND 가상 전화 차단 토스트, 마이크 끊김 오렌지-레드 사이렌, 유사 회의 중복 예약 차단 셰이킹(Shaking UI) 상태 상세 와이어프레임 Specs.

### 3. ⚙️ [시스템 아키텍처 및 AI 파이프라인 (SYSTEM_ARCHITECTURE.md)](file:///d:/TTong_Projects/mdpj/SYSTEM_ARCHITECTURE.md)
* **GCP & Firebase 서버리스 아키텍처** 전력 설계.
* **GCP Speech-to-Text & Gemini 1.5 Pro** 실시간 음성 화자 분리(Diarization) 스트리밍 파이프라인 스펙.
* 모바일과 웹 예약 캘린더 간의 실시간 연동 규격 (**Stitch API Specification**).

### 4. 🔒 [보안성 및 데이터베이스 구조 설계서 (SECURITY_DATABASE.md)](file:///d:/TTong_Projects/mdpj/SECURITY_DATABASE.md)
* **Firestore NoSQL 데이터 모델** (Organizations, Users, Reservations 컬렉션 및 인덱스 설계).
* 9개 기본 단체 간 데이터 격리를 위한 **Firestore Security Rules(행 단위 보안 룰)** 상세 명세.
* 회의록 암호화 정책 및 접근 제어 보안 프레임워크.

---

## 💎 기획 및 설계 3대 철학

1. **초보 담당자도 3초 만에 이해하는 직관성**
   * 카메라 OCR 촬영 한 번으로 회의 셋업이 끝나고, 복잡한 관리 승인 단계 없이 비어있는 시간을 즉시 예약하며, 회의 종료와 동시에 안건 결정사항이 캘린더에 원클릭 자동 연동(Stitch)되는 극도의 간결함을 유지합니다.
2. **신뢰감을 주는 프리미엄 감성 (Classic Warm Minimal)**
   * 복잡하고 차가운 IT 시스템 느낌을 지우고, 형님이 애정하시는 웜베이지와 클래식 골드가 조합된 차분하고 기품 있는 비주얼 분위기를 일관되게 고수합니다.
3. **완벽한 위협 사전 방어 (AI & 보안 설계)**
   * 예약 경쟁으로 인한 어뷰징(동일 회의 다중 등록 예약 행위)을 Gemini AI가 내용 유사도로 즉시 차단하고, 9개 기본 단체 데이터가 1픽셀도 서로 섞이지 않도록 백엔드 수준에서 철저하게 분리 설계되었습니다.
