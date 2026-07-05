# CUJASA MVP 보강 체크리스트

이 문서는 쿠팡 파트너스 자동 포스팅 MVP를 로컬 테스트용에서 운영 가능한 상태로 올리기 위한 작업 목록입니다.

## 1. 보안 필수

- [x] 관리자 로그인 추가
  - [x] 로그인 화면 추가
  - [x] 서버 JWT 또는 세션 인증 추가
  - [x] 인증되지 않은 사용자의 `/api/*` 접근 차단
- [x] API 보호 미들웨어 추가
  - [x] `/api/health`, `/api/auth/login`, `/r/:code`를 제외한 API 인증 필수화
  - [x] 서버 환경변수 `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET` 추가
- [x] Supabase 보안 정리
  - [x] `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 사용
  - [x] 클라이언트에는 service role key 노출 금지
  - [x] RLS 정책 설계
  - [x] 운영 배포 전 RLS 활성화 여부 확인
- [x] 클릭 추적 보호
  - [x] `/r/:code` rate limit 추가
  - [x] 잘못된 code 요청 로깅
  - [x] IP hash salt 환경변수 `IP_HASH_SALT` 추가
- [x] 비밀키 관리
  - [x] `.env` Git 커밋 방지 확인
  - [x] `.env.example`에는 실제 키 미포함 확인
  - [x] 배포 환경변수 분리

## 2. 계정 세팅 UX

- [x] 계정 설정 화면 보강
  - [x] 금지 주제 편집 UI
  - [x] 금지어 편집 UI
  - [x] 활성 시간대 편집 UI
  - [x] 휴식 요일/주당 휴식일 설정 UI
  - [x] 링크 포함 비율 슬라이더
- [ ] 계정별 운영 프리셋 추가 (nice-to-have, seed 데이터에 4종 존재)
- [x] 계정 상태 관리
  - [x] active / paused / archived 상태 전환
  - [x] paused 계정은 주제 생성/큐 생성/업로드 제외

## 3. 쿠팡 API 실전 보정

- [x] 실제 쿠팡 파트너스 API 키 연결
- [x] 실제 응답 필드 확인
  - [x] productId
  - [x] productName
  - [x] productPrice
  - [x] productImage
  - [x] productUrl
  - [x] categoryName
- [x] 파트너스 링크 생성 방식 검증
- [x] API 실패 사유별 activity log 저장
- [x] fallback 검색 URL은 API 실패 시에만 사용되는지 검증
- [x] 상품 중복 제거 강화
- [x] 상품 가격 null 처리 UI 개선

## 4. OpenAI 품질 보강

- [x] JSON 응답 스키마 검증 강화
- [ ] 주제 생성 프롬프트 튜닝
- [ ] 상품 선별 프롬프트 튜닝
- [ ] 콘텐츠 생성 프롬프트 튜닝
- [ ] CTA 생성 프롬프트 튜닝
- [x] 금지 표현 후처리 테스트 추가
- [x] high risk 콘텐츠는 자동 큐 제외 확인
- [ ] manual_required 검수 화면 보강

## 5. 업로드 큐/스케줄러 안정화

- [x] 예약 시간 수동 수정 UI 추가
- [x] 큐 상태별 필터 추가
- [ ] failed/retry/manual_required 처리 UI 개선
- [x] retry 최대 3회 정책 검증
- [x] 서버 재시작 후 pending queue 처리 확인
- [x] node-cron 운영 배포 환경에서 정상 동작 확인
- [ ] mock adapter와 실제 adapter 인터페이스 고정 테스트

## 6. 추적 링크/성과 분석

- [x] 업로드 큐 화면에 tracking link 표시
- [x] 클릭 이벤트 대시보드 표시
- [x] 계정별 클릭 집계 확인
- [x] 주제별 클릭 집계 확인
- [x] 상품별 클릭 집계 확인
- [x] CTA별 클릭 집계 확인
- [x] 24h / 72h / 7d metric job 생성 확인
- [ ] metric job 수동 실행 결과 확인
- [x] 성과 좋은 주제 확장 추천 UI 추가

## 7. 알림

- [ ] Slack webhook 테스트
- [ ] Telegram bot 테스트
- [x] 업로드 실패 알림
- [x] manual_required 발생 알림
- [ ] 업로드 완료 알림
- [ ] 클릭 급증 알림
- [ ] 성과 좋은 글 발견 알림

## 8. 배포 준비

- [x] Render 서버 배포 설정
- [x] Vercel 클라이언트 배포 설정
- [x] `APP_BASE_URL` 운영 도메인 적용
- [x] `CLIENT_BASE_URL` 운영 도메인 적용
- [x] Supabase 운영 DB 연결
- [x] CORS 운영 도메인 제한
- [x] `/api/health` 운영 확인
- [ ] 배포 후 전체 자동화 플로우 재검증

## 9. MVP 완료 기준

- [x] 관리자만 대시보드 접근 가능
- [x] 계정별 설정 저장 가능
- [x] 계정별 주제 생성 가능
- [x] 중복 주제 필터 작동
- [x] 쿠팡 API 상품 검색 작동
- [x] fallback은 API 실패 시에만 작동
- [x] AI 상품 선별 가능
- [x] 콘텐츠와 CTA 생성 가능
- [x] high risk 글은 자동 업로드 제외
- [x] 글을 큐에 넣을 수 있음
- [x] mock Threads 업로드 가능
- [x] `/r/:code` 클릭 추적 가능
- [x] 성과 측정 job 자동 생성
- [x] 클릭 기반 애널리틱스 확인 가능
- [x] SPREAD 메뉴가 프론트에 노출되지 않음
