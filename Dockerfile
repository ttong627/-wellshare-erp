# ===== Stage 1: Build =====
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 캐시 최적화 — package.json만 먼저 복사
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# 소스 복사 후 프로덕션 빌드
COPY . .
RUN npm run build

# ===== Stage 2: Serve =====
FROM nginx:1.27-alpine

# 기본 conf 제거 후 우리 conf 주입
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 빌드 산출물 복사
COPY --from=builder /app/dist /usr/share/nginx/html

# Cloud Run은 PORT 환경변수로 포트를 지정. nginx conf에서 $PORT 치환.
EXPOSE 8080

# 시작 시 PORT 치환 후 nginx 실행
CMD ["/bin/sh", "-c", "envsubst '${PORT}' < /etc/nginx/conf.d/default.conf > /tmp/default.conf && mv /tmp/default.conf /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
