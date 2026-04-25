# CUJASA

쿠팡 파트너스 자동 포스팅 MVP입니다. 운영 단위는 계정이며, 프론트에는 쿠팡 파트너스 자동화만 노출합니다. SPREAD는 `project_type = spread`와 `spreadService` 구조만 남겨두었습니다.

## 설치

```bash
npm run install:all
cp .env.example server/.env
```

## Supabase 적용

Supabase SQL editor에서 아래 순서로 실행합니다.

```sql
-- supabase/schema.sql
-- supabase/seed.sql
```

필수 환경변수는 `server/.env`에 넣습니다.

```bash
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAIL=
ADMIN_PASSWORD_HASH=
JWT_SECRET=
IP_HASH_SALT=
TRACKING_RATE_LIMIT_WINDOW_MS=60000
TRACKING_RATE_LIMIT_MAX=120
COUPANG_ACCESS_KEY=
COUPANG_SECRET_KEY=
COUPANG_PARTNER_ID=
COUPANG_TRACKING_CODE=
APP_BASE_URL=http://localhost:3005
CLIENT_BASE_URL=http://localhost:5175
MOCK_UPLOAD=true
```

Supabase 키가 없어도 로컬 메모리 seed로 UI/API 흐름을 확인할 수 있습니다.

## 관리자 로그인 설정

운영에서는 `/api/health`, `/api/auth/login`, `/r/:code`를 제외한 API가 관리자 토큰을 요구합니다.

비밀번호 hash를 먼저 생성합니다.

```bash
npm run hash:password --prefix server -- "원하는-관리자-비밀번호"
```

출력된 값을 `server/.env`에 넣습니다.

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=pbkdf2$...
JWT_SECRET=길고-랜덤한-문자열
IP_HASH_SALT=길고-랜덤한-문자열
```

개발 환경에서 위 값이 없으면 로컬 테스트 편의를 위해 인증이 우회됩니다. `NODE_ENV=production`에서는 인증 설정이 없으면 보호 API가 차단됩니다.

## 로컬 실행

```bash
npm run dev
```

클라이언트: `http://localhost:5175`  
서버: `http://localhost:3005`

## 쿠팡 API

`COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY`가 있으면 HMAC SHA256 서명으로 쿠팡 파트너스 검색 API를 호출합니다. API 실패 또는 키 미설정 시 쿠팡 검색 URL fallback 상품을 저장합니다.
`COUPANG_TRACKING_CODE`가 있으면 쿠팡 요청에 `subId`로 붙여 채널별 성과를 추적합니다.

쿠팡 API만 단독 테스트:

```bash
npm run test:coupang --prefix server -- "탈취제"
```

성공 기준은 `real api products`가 1개 이상이고, 저장된 `coupang_products.is_fallback` 값이 `false`인 상품이 생기는 것입니다.

## Mock 업로드 테스트

1. 계정 선택
2. 주제 자동 생성
3. 상품 검색
4. 콘텐츠 생성
5. 큐에 넣기
6. 업로드 큐에서 `실행` 또는 `스케줄러 실행`

초기 Threads adapter는 실제 업로드하지 않고 콘솔에 내용을 출력하며 mock `post_url`을 생성합니다.

## 추적 링크 테스트

업로드가 완료되면 `tracking_links`에 `/r/:code` 링크가 생성됩니다.

```bash
curl -I http://localhost:3005/r/{code}
```

클릭 시 `click_events`에 IP hash, user agent, referrer가 저장되고 목적지로 redirect됩니다.
존재하지 않는 tracking code 요청은 `activity_logs`에 `tracking_code_not_found`로 저장됩니다. `/r/:code`에는 기본 rate limit이 적용됩니다.

## 스케줄러

서버는 매분 `post_queue`와 `post_metrics_jobs`를 확인합니다. 수동 실행도 가능합니다.

```bash
curl -X POST http://localhost:3005/api/scheduler/run
curl -X POST http://localhost:3005/api/metrics/run-jobs
```

성과 측정 job은 업로드 완료 후 24시간, 72시간, 7일 시점으로 자동 생성됩니다.

## 배포 준비

권장 구성은 Render API 서버 + Vercel 클라이언트 + Supabase입니다.

### Render 서버

1. Render에서 새 Blueprint 또는 Web Service를 생성합니다.
2. 저장소 루트의 `render.yaml`을 사용하거나 아래 설정을 수동 입력합니다.

```text
Root Directory: .
Build Command: npm install --prefix server
Start Command: npm start --prefix server
Health Check Path: /api/health
```

3. Render 환경변수에 아래 값을 넣습니다.

```env
NODE_ENV=production
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAIL=
ADMIN_PASSWORD_HASH=
JWT_SECRET=
IP_HASH_SALT=
APP_BASE_URL=https://your-render-api.onrender.com
CLIENT_BASE_URL=https://your-vercel-client.vercel.app
COUPANG_ACCESS_KEY=
COUPANG_SECRET_KEY=
COUPANG_PARTNER_ID=
COUPANG_TRACKING_CODE=
MOCK_UPLOAD=true
TRACKING_RATE_LIMIT_WINDOW_MS=60000
TRACKING_RATE_LIMIT_MAX=120
```

`CLIENT_BASE_URL`은 쉼표로 여러 origin을 넣을 수 있습니다.

```env
CLIENT_BASE_URL=http://localhost:5175,https://your-vercel-client.vercel.app
```

### Vercel 클라이언트

1. Vercel에서 프로젝트를 생성합니다.
2. Root Directory를 `client`로 설정합니다.
3. Build Command는 `npm run build`, Output Directory는 `dist`입니다.
4. Vercel 환경변수에 API 주소를 넣습니다.

```env
VITE_API_BASE_URL=https://your-render-api.onrender.com
```

### 배포 후 확인

```bash
curl -I https://your-render-api.onrender.com/api/health
```

프론트에서 로그인 후 아래 순서로 최종 확인합니다.

1. 주제 자동 생성
2. 상품 검색
3. `coupang_products.is_fallback = false` 확인
4. 콘텐츠 생성
5. 큐에 넣기
6. mock 업로드 실행
7. `/r/:code` 클릭
8. `click_events` 저장 확인
