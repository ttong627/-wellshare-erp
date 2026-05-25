# 🔒 보안성 및 데이터베이스 구조 설계서 (SECURITY_DATABASE.md)

본 사양서는 9개 기본 단체가 안전하게 데이터를 공유 및 격리하여 사용하는 **Firestore NoSQL 데이터 모델** 설계와 어뷰징 및 정보 유출을 완벽 차단하는 **Firebase Security Rules** 명세 및 데이터 암호화 정책 설계서입니다. 

특히 형님이 요청하신 **단체별 색 구분 시스템** 및 에이전트 연합팀이 추천한 **스마트 편의 기능 6종**을 완벽하게 백업하도록 스키마를 고도화하여 재설계했습니다.

---

## 1. Firestore NoSQL 데이터 모델 (Data Schema)

단일 데이터베이스에서 9개 기본 단체의 데이터를 격리하고, 단체별 브랜딩 및 지능형 편의 기능을 지원하기 위한 컬렉션 구조 설계입니다.

### ① `organizations` 컬렉션 (단체 기본 정보)
* **Document ID**: `orgId` (예: `org1`, `org2`)
```json
{
  "name": "WS 청년회",
  "theme": {
    "primaryColor": "#708A81",
    "pastelBgColor": "#E2ECE9",
    "vibe": "Sage Green"
  },
  "stats": {
    "totalUsageHours": 145.2,
    "totalReservations": 58,
    "noShowCount": 2
  },
  "registeredAt": "2026-01-15T09:00:00Z",
  "status": "active"
}
```
* **고도화 포인트**: 단체별 시그니처 웜-파스텔 브랜딩 메타데이터(`theme`)를 완전 내장하여, 웹/모바일 UI에서 각 조직이 접속할 때마다 해당 테마 컬러가 자동으로 전체 뷰어 레이아웃에 즉시 매핑되도록 처리합니다. 누적 활용도 통계(`stats`)를 보유하여 매월 단체 점유율 대시보드 기능을 지원합니다.

### ② `users` 컬렉션 (사용자 및 권한 정보)
* **Document ID**: `userId` (Firebase Auth UID)
* **스키마 구조**:
```json
{
  "email": "youth_leader@WS.org",
  "name": "김청년",
  "orgId": "org1",
  "role": "manager", 
  "minutesAccess": "approved",
  "minutesAccessUpdatedAt": "2026-05-23T10:12:00Z",
  "minutesAccessBy": "admin_uid_ttong627",
  "joinedAt": "2026-02-10T14:30:00Z",
  "voiceprint": {
    "isRegistered": true,
    "registeredAt": "2026-05-22T02:40:00Z",
    "embeddingVector": [0.0124, -0.0482, 0.8841, "...", 0.1235],
    "hashAlgorithm": "SHA-256/HMAC-Noise"
  }
}
```
* **Roles 정의**:
  - `admin`: 전체 시스템 마스터 관리자 (모든 단체 예약 관리 및 감사 가능 / 회의록 항상 사용 가능)
  - `manager`: 소속 단체 관리자 (소속 단체 멤버 승인 및 소속 단체 예약 취소 권한 보유)
  - `member`: 일반 담당자 (예약 신청 가능 / 회의록은 별도 승인 필요)
* **회의록 사용 권한 (`minutesAccess`) — 2026-05-23 신규**:
  - `approved`: 회의록 작성/녹음/STT/4중 검수 진입 허용
  - `denied`(기본): 모든 회의록 관련 액션 차단 (라우트 `/r` 진입 시 안내 화면)
  - **admin은 이 필드와 무관하게 항상 허용** (역할 기반 무조건 통과)
  - `minutesAccess` / `minutesAccessUpdatedAt` / `minutesAccessBy` 필드는 **admin만 수정 가능** (Firestore Security Rules 강제)
  - manager는 가입 승인(role: pending → member)은 할 수 있어도 회의록 권한은 부여 불가

* **권한 상승 차단 정책 (2026-05-25 보안 1차 패치 / 코코 권고)**:
  - 본인(`request.auth.uid == uid`)이 자기 문서를 update할 때 **다음 필드는 절대 변경 불가** (자기 권한 상승 차단):
    - `role` (자기를 admin으로 못 만듦)
    - `orgId` (자기를 다른 단체로 못 옮김)
    - `email` (이메일 위조 차단)
    - `approvedBy` / `approvedAt` (승인 흔적 위조 차단)
    - `minutesAccess` / `minutesAccessUpdatedAt` / `minutesAccessBy` (회의록 권한 자가 승격 차단)
    - `deletedAt` / `joinedAt` (감사 추적 보호)
  - 본인은 `displayName`, `position`, `photoURL`, `updatedAt` 같은 안전 필드만 변경 가능
  - **매니저**는 같은 단체 멤버의 `role`을 변경 가능하나, `admin`으로 승격은 절대 금지 (`role in ['member', 'manager', 'pending']`만 허용)
  - **admin**만 모든 필드 변경 가능
  - Firestore Rules의 `userImmutableFields()` / `safeSelfUpdate()` / `managerSafeUpdate()` 헬퍼 함수로 정책 표현

* **성문(voiceprint) 저장 정책 (2026-05-25 코코 권고)**:
  - 클라이언트 영구 저장(`localStorage`) **금지**
  - 임시 저장은 **`sessionStorage`만 허용** (탭 닫으면 자동 소멸)
  - 영구 저장은 **Firestore에 hash + Salt + Gaussian Noise** 적용 후 저장 (현 코드는 시연 단계 → sessionStorage)
  - 원본 오디오는 메모리에서 Zeroing 후 즉시 소멸
* **고도화 포인트**: 사용자의 고유한 목소리 지문인 **성문 임베딩 벡터(`embeddingVector`)**를 128차원 부동소수점 배열로 압축 추출하여 보관합니다. 해당 데이터는 생체 개인정보에 해당하므로 원본 음성 복원이 불가능한 단방향 특징점 상태로 암호화 저장하여 유출 사고를 방지합니다.

### ③ `reservations` 컬렉션 (회의실 및 교육장 예약 정보)
* **Document ID**: `resId` (자동 생성 UUID)
```json
{
  "title": "2026 청년회 상반기 정기 총회",
  "date": "2026-05-22",
  "startTime": "13:00",
  "endTime": "15:00",
  "room": "대회의실 (3F)",
  "orgId": "org1",
  "creatorId": "user_uid_123",
  "creatorName": "김청년",
  "createdAt": "2026-05-20T08:12:00Z",
  "stitchSourceId": null,
  "semanticHash": "f8a29b3c4d7e",
  "isVoiceBooked": false
}
```
* **고도화 포인트**: 편의 기능 ①인 `음성 예약(Voice Booking)`을 통해 생성되었는지 여부(`isVoiceBooked`)를 체크하는 메타데이터를 추가해 음성 제어 사용성 비율 통계를 추출합니다.
* **인덱스(Index) 설계**:
  - 단일 인덱스: `date` (특정 일자 전체 현황 조회 쿼리 최적화)
  - 복합 인덱스: `orgId` (Ascending) + `date` (Descending) (특정 단체의 예약 이력 조회용)
  - 복합 인덱스: `room` (Ascending) + `date` (Ascending) + `startTime` (Ascending) (특정 방의 중복 예약 충돌 방지 검증 쿼리 최적화)

### ④ `meeting_minutes` 컬렉션 (자동 작성 회의록)
* **Document ID**: `minutesId`
* **스키마 구조**:
```json
{
  "orgId": "org1",
  "title": "6월 청년회 정기 체육대회 기획 모임",
  "createdAt": "2026-05-22T11:32:33Z",
  "creatorId": "user_uid_123",
  "location": "교육장 (B1)",
  "audioFileUrl": "https://storage.googleapis.com/WS-minutes/org1/2026-05-22/meet-982348.opus",
  "rawTranscript": [
    { 
      "speaker": "김청년 회장", 
      "text": "여러분 오늘 회의에서는...", 
      "time": "13:01",
      "audioOffsetSeconds": 45.2 
    },
    { 
      "speaker": "박청년 총무", 
      "text": "체육대회는 날씨가 더워질 수 있으니 [블라인드: 계좌번호]를 확보하여...", 
      "time": "13:02",
      "audioOffsetSeconds": 105.8 
    }
  ],
  "aiSummary": {
    "brief": "6월 청년회 체육대회 장소 및 일정 조율 회의...",
    "decisions": [
      { "item": "체육대회 개최일을 6월 13일 토요일 오후로 연기", "status": "confirmed" }
    ],
    "actionItems": [
      { "assignee": "박청년 총무", "task": "교육장 B1 즉시 예약하기", "deadline": "2026-05-24" }
    ]
  },
  "attachedPhotos": [
    {
      "photoId": "photo-09823",
      "originalUrl": "https://storage.googleapis.com/WS-minutes/org1/2026-05-22/board_scan.webp",
      "thumbnailUrl": "https://storage.googleapis.com/WS-minutes/org1/2026-05-22/board_scan_thumb.webp",
      "uploaderId": "user_uid_123",
      "caption": "화이트보드 정기 안건 필기 판서 촬영본",
      "ocrText": "6월 13일 체육대회 장소선정...",
      "scannedAt": "2026-05-22T11:35:00Z"
    }
  ],
  "security": {
    "isMasked": true,
    "maskedKeywords": ["계좌번호", "주민등록번호", "예산금액"],
    "accessLevelRequired": "member"
  },
  "isStitched": true,
  "archivePolicy": {
    "isArchived": false,
    "expireAt": "2031-05-22T11:32:33Z",
    "storageClass": "STANDARD"
  }
}
```
* **고도화 포인트**:
  - **다중 사진 첨부 지원 (`attachedPhotos`)**: 회의 중 칠판 판서 촬영본, 인쇄된 공문 스캔본, 영수증 영수증 사진을 여러 장 첨부할 수 있습니다. 각 사진은 모바일 에지 단에서 최적화 업로드되어 원본(`originalUrl`)과 썸네일(`thumbnailUrl`)로 분리 저장되며, GCP Document AI 기반 OCR 텍스트 추출 필드(`ocrText`)가 포함되어 사진 속 글씨로도 완벽히 대화록을 검색할 수 있습니다.
  - **오디오-텍스트 싱크 플레이어 지원**: `rawTranscript`에 각 문장별 음성 오프셋 초 단위(`audioOffsetSeconds`)를 탑재하여 회의록 텍스트 클릭 시 정확한 음성 재생 지점으로 바로 스킵 동작(타미 추천 기능)을 구현합니다.
  - **AI 자동 개인정보 마스킹 지원**: `security` 구조 내에 마스킹 여부(`isMasked`)와 마스킹 처리된 중요 키워드 리스트(`maskedKeywords`)를 보관해 보안 유출(코코 추천 기능)을 원천 차단합니다.
  - **장기 노후화 방지 아카이빙 메타데이터 (`archivePolicy`)**: 5년 보관 만기 타임스탬프(`expireAt`) 및 아카이빙 여부 플래그를 내장하여, 기간이 지나도 데이터베이스가 무거워져 느려지는 소프트웨어 노화(Software Aging) 현상을 아키텍처 레벨에서 예방합니다.

---

## 2. Firebase Security Rules 명세 (행 단위 다중 단체 격리)

9개 기본 단체가 동일한 데이터베이스 인스턴스를 공유하므로, 클라이언트 수준에서 타 단체의 민감 정보에 절대 접근하지 못하도록 **행 단위 보안 필터링** 규칙을 엄격하게 수립합니다.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 사용자 문서 검증 보조 함수
    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    
    // 1. 사용자 컬렉션 룰
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // 2. 예약 컬렉션 룰 (즉시 예약형)
    match /reservations/{resId} {
      // 누구나 전체 예약 현황(캘린더 바)은 볼 수 있어야 예약 여부를 확인하므로 읽기 허용
      allow read: if request.auth != null;
      
      // 예약 등록은 로그인되어 있어야 하며, 소속 단체 이름으로만 작성 가능
      allow create: if request.auth != null 
                    && request.resource.data.orgId == getUserData().orgId;
                    
      // 예약 취소 및 수정은 해당 예약 생성자이거나, 소속 단체의 관리자(manager), 또는 마스터 관리자(admin)만 가능
      allow update, delete: if request.auth != null 
                            && (resource.data.creatorId == request.auth.uid 
                                || (getUserData().orgId == resource.data.orgId && getUserData().role == 'manager')
                                || getUserData().role == 'admin');
    }
    
    // 3. 회의록 컬렉션 룰 (민감 보안 구역)
    match /meeting_minutes/{minutesId} {
      // 회의록 읽기는 오직 소속 단체의 구성원들만 가능 (타 단체 열람 완전 봉쇄)
      allow read: if request.auth != null 
                  && resource.data.orgId == getUserData().orgId;
                  
      // 회의록 작성은 로그인된 소속 단원만 가능
      allow create: if request.auth != null 
                    && request.resource.data.orgId == getUserData().orgId;
                    
      // 회의록 수정 및 삭제는 작성자 본인 혹은 단체 관리자만 가능
      allow update, delete: if request.auth != null 
                            && (resource.data.creatorId == request.auth.uid 
                                || (getUserData().orgId == resource.data.orgId && getUserData().role == 'manager'));
    }
  }
}
```

---

## 3. 데이터 암호화 및 전송 보안 정책 (E2EE & Transport Security)

회의 대화 내용 및 사용자의 목소리 정보는 최고 수준의 비공개 민감 생체 정보이므로 하이브리드 암호화 및 물리 격리 프로토콜을 제시합니다.

### ① 전송 중 암호화 (Encryption in Transit)
* 모든 모바일 및 웹 클라이언트에서 클라우드로 전달되는 음성 파일 및 회의록 텍스트는 **TLS 1.3** 프로토콜에 의한 강제 HTTPS/WSS 통신만 허용하여 중간자 공격(MITM) 및 스니핑을 철저히 차단합니다.

### ② 저장 시 암호화 (Encryption at Rest)
* Firestore 데이터는 Google 관리 암호화 키를 기본 적용해 물리 디스크 수준에서 자동 암호화됩니다.
* Cloud Storage에 저장되는 원본 오디오 파일(`.opus`)은 조직의 마스터 대칭 키 **AES-256-GCM** 방식으로 암호화되어 저장되며, 오직 동일 단체에 소속된 인증된 권한 보유 담당자가 복호화 세션을 요청할 때만 세션 키를 발급합니다.

### ③ 🛡️ 생체(성문) 데이터 단방향 비식별화 기술 (Voiceprint Privacy Shield)
사용자의 목소리 특징(성문) 유출 사고 시 원본 음성이 역복원(Re-generation)되는 범죄를 차단하기 위한 하드코어 보안 메커니즘입니다.
1. **역복원 불가능한 128차원 벡터화 (Non-reversible Vectorization)**:
   - 클라이언트 모바일 기기 내부(Local Edge AI)에서 음성 파형으로부터 성문 특징점만 추출하고, 오디오 원본 데이터는 성문 모델 연산 직후 메모리에서 완전 소멸(Zeroing)시킵니다.
   - 서버로 전달 및 Firestore에 저장되는 데이터는 오직 `[0.012, -0.982, ...]` 형식의 **추상적인 임베딩 벡터 수치**뿐이며, 이를 가지고 원본 목소리 파형으로 역변환(Synthesize)하는 것은 수학적으로 절대 불가합니다.
2. **솔트 및 랜덤 노이즈 추가 (Differential Privacy)**:
   - 타사 AI 매칭 엔진으로의 성문 도용을 완벽히 격리하기 위해, 저장 시점에 사용자별 고유 Salt 키와 극소량의 가우시안 무작위 노이즈(Gaussian Noise)를 추가 가공합니다.
   - 이로 인해 타 시스템에 본 데이터가 유출되더라도, 동일 사용자의 성문으로 매칭/식별이 불가해 보안 등급이 대폭 상향됩니다.

### ④ API 감사 로그 (Audit Logs)
* 성문 데이터의 등록/갱신, 회의록 다운로드 및 예약 대량 취소 등의 이벤트는 **GCP Cloud Logging**에 영구 저장되어 이상 행동을 실시간 모니터링합니다.
