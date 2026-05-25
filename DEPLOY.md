# 🚀 WS 시스템 — Google Cloud 배포 가이드

> 형님이 PowerShell에서 **명령어를 그대로 복붙**만 하시면 됩니다.
> Firebase는 구글 소유의 GCP 서비스라서 어느 경로로 가셔도 "구글 클라우드 배포"입니다.

---

## 🗺️ 경로 비교 — 어느 것을 고르실까요

| | **A. Firebase Hosting** | **B. Cloud Run** | **C. Cloud Storage + LB** |
|---|---|---|---|
| 난이도 | ⭐ 매우 쉬움 | ⭐⭐⭐ 보통 | ⭐⭐⭐⭐ 어려움 |
| 소요 시간 | 5분 | 15분 | 30분+ |
| 비용 (현재 규모) | **무료** (10GB/월) | **무료** (200만 req/월) | 약 $5-10/월 (LB 고정비) |
| HTTPS / CDN | ✅ 자동 | ✅ 자동 | ⚠️ Cloud CDN 별도 설정 |
| 커스텀 도메인 | ✅ 무료 | ✅ 무료 | ✅ 무료 |
| 추후 백엔드 추가 | Functions 추가 | 같은 컨테이너에 API 통합 | 별도 서비스 |
| GCP 콘솔에서 보이는가 | "Firebase" 섹션 | "Cloud Run" 섹션 | "Storage" + "Network Services" |
| **추천** | ✅ **본 프로젝트 1순위** | ☑️ 컨테이너 친숙 시 | ❌ 기업 정책 강제 시만 |

**한 줄 요약**: 그냥 빠르게 띄우시려면 **A**. 회사 정책상 "Cloud Run에 배포해야" 한다면 **B**. 둘 다 GCP 콘솔에 보입니다.

---

## ⚙️ 0. 사전 준비 (1회만)

### Node.js 확인
```powershell
node -v   # v18 이상
npm -v
```

### Google Cloud SDK (gcloud) 설치 — B/C 경로만 필요, A는 불필요
```powershell
# 방법 1: 공식 인스톨러 (가장 안정)
# https://cloud.google.com/sdk/docs/install#windows 에서 GoogleCloudSDKInstaller.exe 다운로드 → 실행
# 설치 후 PowerShell 재시작 필수

# 방법 2: Chocolatey
choco install gcloudsdk

# 확인
gcloud --version
```

### Firebase CLI 설치 — A 경로만 필요
```powershell
npm install -g firebase-tools
firebase --version
```

### GCP 프로젝트 만들기 (모든 경로 공통)
1. https://console.cloud.google.com 접속 → 형님 구글 계정으로 로그인
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름 입력 (예: `WS-system-2026`)
3. **프로젝트 ID**를 복사 (자동 생성된 것 그대로 사용해도 OK)
4. 결제 계정 연결 ← Cloud Run/Storage 사용 시 필수 (무료 한도 내라도 카드 등록 요구)

---

# 🅰️ A 경로 — Firebase Hosting (5분, 추천)

### A-1. 로그인
```powershell
firebase login
```
→ 브라우저에서 구글 로그인. 완료되면 PowerShell로 복귀.

### A-2. `.firebaserc`에 프로젝트 ID 입력
프로젝트 루트 `.firebaserc` 파일 열어 `WS-PROJECT-ID-...` 부분을 GCP 프로젝트 ID로 교체.

### A-3. 빌드 → 배포
```powershell
npm run build
firebase deploy --only hosting
```

성공 시:
```
✔  Deploy complete!
Hosting URL: https://WS-system-2026.web.app
```

→ 이 URL이 라이브 사이트. 끝.

---

# 🅱️ B 경로 — Cloud Run (15분, 컨테이너 정통파)

> 💡 **로컬에 Docker가 없어도 됩니다.** `gcloud run deploy --source .` 명령이 형님 코드를 Cloud Build에 업로드해 **클라우드에서 이미지를 빌드**합니다. 형님 PC엔 gcloud CLI만 있으면 됩니다.

### B-1. gcloud 인증 및 프로젝트 설정
```powershell
gcloud auth login
gcloud config set project YOUR-PROJECT-ID
gcloud config set run/region asia-northeast3   # 서울 리전 (가장 빠름)
```

### B-2. 필요한 API 활성화 (한 번만)
```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

### B-3. Artifact Registry 저장소 생성 (한 번만)
```powershell
gcloud artifacts repositories create WS-repo `
  --repository-format=docker `
  --location=asia-northeast3 `
  --description="WS 컨테이너 이미지"
```

### B-4. 빌드 + 배포 (한 줄!)
```powershell
gcloud run deploy WS-web `
  --source . `
  --region=asia-northeast3 `
  --allow-unauthenticated `
  --port=8080 `
  --memory=256Mi `
  --max-instances=10
```

→ gcloud가 자동으로:
1. 현재 폴더를 Cloud Build에 업로드 (`.gcloudignore` 따름)
2. `Dockerfile` 기반으로 이미지 빌드
3. Artifact Registry에 푸시
4. Cloud Run에 배포

성공 시:
```
Service [WS-web] revision [WS-web-00001-xyz] has been deployed
Service URL: https://WS-web-XXXXXXXXX-du.a.run.app
```

→ 이 URL이 라이브 사이트.

### B-5. (선택) cloudbuild.yaml 기반 CI 빌드
`cloudbuild.yaml`이 이미 준비되어 있어 다음 한 줄로도 가능:
```powershell
gcloud builds submit --config=cloudbuild.yaml --substitutions=_SERVICE=WS-web .
```

### B-6. 커스텀 도메인 연결 (선택)
```powershell
gcloud run domain-mappings create --service=WS-web --domain=app.WS.kr --region=asia-northeast3
```
→ 출력되는 DNS 레코드를 도메인 등록기관에 입력.

### B-7. 재배포 (코드 수정 시)
```powershell
gcloud run deploy WS-web --source . --region=asia-northeast3
```
한 줄로 끝.

---

# 🅲 C 경로 — Cloud Storage + Load Balancer (30분+, 기업용)

> ⚠️ **권장하지 않습니다.** 정적 사이트라도 무료 한도가 없고 LB 고정비 발생.
> 회사에서 "반드시 GCS에 호스팅"을 요구할 때만 사용하세요.

### C-1. 버킷 생성
```powershell
gcloud storage buckets create gs://WS-web-static `
  --location=asia-northeast3 `
  --uniform-bucket-level-access
```

### C-2. 빌드 + 업로드
```powershell
npm run build
gcloud storage cp -r dist/* gs://WS-web-static/
```

### C-3. 공개 액세스 부여
```powershell
gcloud storage buckets add-iam-policy-binding gs://WS-web-static `
  --member=allUsers `
  --role=roles/storage.objectViewer
```

### C-4. Web Static Hosting 설정
```powershell
gcloud storage buckets update gs://WS-web-static `
  --web-main-page-suffix=index.html `
  --web-error-page=index.html
```

### C-5. Cloud Load Balancer + Cloud CDN 연결
GCP 콘솔 → **네트워크 서비스 → 부하 분산** → **로드 밸런서 만들기** → HTTPS(클래식) → 백엔드 버킷에 `WS-web-static` 연결 → CDN 사용 체크 → 프론트엔드 IP+443 포트 + 관리형 SSL 인증서 생성.

도메인 DNS A 레코드 → 위 IP로 매핑.

→ 15-30분 후 인증서 프로비저닝 완료, `https://app.WS.kr` 로 접속.

---

## 🔁 일상 재배포 한 줄 비교

| 경로 | 명령 |
|---|---|
| Firebase | `npm run build; firebase deploy --only hosting` |
| Cloud Run | `gcloud run deploy WS-web --source . --region=asia-northeast3` |
| GCS | `npm run build; gcloud storage cp -r dist/* gs://WS-web-static/` |

---

## 🆘 자주 발생하는 문제

| 에러 | 해결 |
|---|---|
| `'gcloud' 용어가 인식되지 않습니다` | gcloud SDK 미설치. https://cloud.google.com/sdk/docs/install 에서 인스톨러 받고 PowerShell 재시작 |
| `'firebase' 용어가 인식되지 않습니다` | `npm install -g firebase-tools` 후 PowerShell 재시작 |
| `PERMISSION_DENIED: Cloud Run API has not been used` | `gcloud services enable run.googleapis.com` 실행 |
| `Billing account required` | https://console.cloud.google.com/billing 에서 결제 계정 연결 |
| `Artifact Registry repo not found` | 위 B-3 명령으로 `WS-repo` 생성 |
| Cloud Run 첫 요청이 느림 (1-3초) | Cold Start. `--min-instances=1` 추가 시 항상 켜둔 상태 (소액 과금) |
| 서비스 URL 접속 시 403 | `--allow-unauthenticated` 누락. 위 B-4 명령 다시 실행 |

---

## 📱 APK 빌드 (Bubblewrap TWA — 모든 경로 공통)

위 A/B/C 중 하나로 웹 배포가 끝난 후:

### JDK 17 + Bubblewrap 설치 (1회만)
```powershell
choco install temurin17
npm install -g @bubblewrap/cli
java -version    # openjdk 17 확인
```

### TWA 초기화 + 빌드
```powershell
cd D:\TTong_Projects
mkdir mdpj-twa; cd mdpj-twa

# A 경로 사용 시
bubblewrap init --manifest=https://YOUR-PROJECT-ID.web.app/manifest.webmanifest

# B 경로 사용 시
bubblewrap init --manifest=https://WS-web-XXXXX-du.a.run.app/manifest.webmanifest

bubblewrap build
```

→ `mdpj-twa/app-release-signed.apk` ← **이게 형님이 원하시는 APK**

### Digital Asset Links 등록 (Chrome 주소바 숨기기 위해 필수)
Bubblewrap이 마지막에 출력하는 `assetlinks.json`을 복사 → 프로젝트 `public/.well-known/assetlinks.json`에 저장 → 다시 배포.

---

## 📤 APK 다운로드 링크

APK 파일 생성 후 형님 계정으로 호스팅:

| 옵션 | 명령 / 방법 |
|---|---|
| **Firebase App Distribution** | `firebase appdistribution:distribute app-release-signed.apk --app YOUR-APP-ID --groups testers` |
| **Google Drive** | Drive에 업로드 → 우클릭 "링크 공유" → "링크가 있는 모든 사용자" |
| **GitHub Releases** | GitHub에 push → Releases → Draft → APK 첨부 → Publish |
| **Cloud Storage** | `gcloud storage cp app-release-signed.apk gs://WS-downloads/` 후 공개 IAM |

---

## ✅ 최종 체크리스트

배포 전:
- [ ] `npm run build` 성공
- [ ] `.firebaserc` 또는 gcloud 프로젝트 ID 설정됨
- [ ] (Cloud Run/GCS) 결제 계정 연결됨

배포 후:
- [ ] 라이브 URL 접속 가능
- [ ] PWA 설치 가능 (Android Chrome "홈화면에 추가")
- [ ] Lighthouse PWA 점수 ≥ 90 (Chrome DevTools)
- [ ] (APK) `assetlinks.json` 호스팅 후 Chrome 주소바 사라짐

---

## 🎯 형님이 받게 되시는 최종 결과물

| 산출물 | 어디서 |
|---|---|
| **라이브 웹 URL** | A: `*.web.app` · B: `*.a.run.app` · C: 형님 도메인 |
| **PWA** | 위 URL을 Android Chrome에서 "홈화면에 추가" |
| **APK 파일** | `mdpj-twa/app-release-signed.apk` |
| **APK 공유 링크** | Firebase App Distribution / Drive / GitHub / GCS 중 선택 |
