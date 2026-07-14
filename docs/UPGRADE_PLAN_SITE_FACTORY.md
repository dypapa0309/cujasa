# CUJASA 전면 개선 기획 — 이슈 커머스 "사이트 팩토리"

작성일: 2026-07-14
전제 대화: 뉴스 기반 100% 자동 이슈 커머스 전환(이슈 클러스터 + AI 브리핑 + 원문 링크 + 상품 매칭 + 스레드 + 클릭 랭킹) + 회원별 사이트 복제 제공

---

## 1. 한 줄 정의

> 회원이 대시보드에서 **[사이트 생성]** 버튼을 누르면, 자기 쿠팡파트너스 키로 수익이 잡히는 **자동 이슈 커머스 사이트**가 즉시 발급되는 사이트 팩토리 SaaS.

- 운영자(나)의 사이트 = 테넌트 #0. 회원 사이트와 같은 엔진.
- 콘텐츠(뉴스 수집→클러스터→브리핑)는 **전 테넌트 공유 1회 생성**, 수익 링크(쿠팡 딥링크)만 **테넌트별 키로 변환**.

## 2. 핵심 아키텍처 결정: 복제가 아니라 멀티테넌트

"[생성] 버튼 → 사이트 복제"의 구현 방식 두 가지 중:

| | A. 코드/배포 복제 (Render 서비스 N개) | B. 단일 인스턴스 멀티테넌트 (채택) |
|---|---|---|
| 생성 속도 | 빌드+배포 수 분~수십 분 | **즉시 (DB row 1개)** |
| 월 비용 | 테넌트당 Render 서비스 비용 발생 | 고정 (기존 cujasa-api 1대) |
| LLM 비용 | 테넌트당 파이프라인 중복 실행 | **1회 생성 전 테넌트 공유** |
| 업데이트 | N개 재배포 지옥 | 배포 1번이면 전 사이트 반영 |
| 장애 | 관리 불가 | 단일 관측 지점 |

**결정: B.** "복제"는 사용자 눈에 보이는 개념(자기 링크, 자기 사이트명, 자기 수익)이고, 물리적으로는 테넌트 row + 와일드카드 라우팅이다.

## 3. URL / 도메인 전략

- 1단계(MVP): 경로 기반 — `cujasa.com/s/{slug}` (DNS 작업 없음, 즉시 발급)
- 2단계: 서브도메인 — `{slug}.cujasa.com` (Render 와일드카드 도메인 + `*.cujasa.com` CNAME)
- 3단계(유료 옵션): 커스텀 도메인 연결 — 회원 도메인 CNAME + 테넌트 매핑 테이블

테넌트 해석 미들웨어: `Host` 헤더 → 서브도메인/커스텀 도메인 매핑 → 없으면 `/s/{slug}` 경로 → `req.site` 주입.

## 4. 사이트 생성 플로우 ([생성] 버튼)

```
대시보드 → [사이트 생성]
 ↓
① 사이트명 / slug 자동 제안 (중복 검사)
② 쿠팡파트너스 Access Key / Secret Key / 트래킹 코드 입력
   └ 즉시 검증: 딥링크 API 테스트 호출 1회 → 실패 시 생성 불가
③ 관심 카테고리 선택 (3~5개: 생활/가전/육아/식품/건강뷰티/캠핑/반려…)
④ 테마 선택 (컬러/로고 텍스트 — 템플릿 3종이면 충분)
 ↓
sites row 생성 → 직전 24h 공유 이슈 피드에 테넌트 딥링크 백필 (수 초)
 ↓
"https://cujasa.com/s/{slug} 발급 완료" — 처음부터 콘텐츠 차 있는 상태로 오픈
```

핵심 UX: **생성 직후 빈 사이트가 아니라 이미 오늘의 이슈/상품이 차 있는 사이트**가 떠야 한다. 공유 콘텐츠 레이어 덕분에 가능.

## 5. 콘텐츠 파이프라인 — 공유 레이어 vs 테넌트 레이어

### 5.1 공유 레이어 (전 테넌트 1회 실행, 기존 크론 확장)

```
뉴스 RSS/API 수집 (제목·출처·URL·발행일·리드만 저장, 전문 저장 금지)
 ↓ 규칙 기반: 키워드 추출·중복 제거·이슈 클러스터링
 ↓ 싼 LLM(gpt-4.1-mini 유지) 클러스터 단위 1회 브리핑 생성 + 3~6h 캐시
 ↓ 이슈→상품 키워드 매핑 (룰 테이블 우선, LLM은 후보 보조)
 ↓ 쿠팡 상품 검색 (운영자 키 1개로 상품 메타데이터만 조회·캐시)
 = issues / issue_sources / issue_products (전역 테이블)
```

LLM 비용은 테넌트 수와 **무관** — 테넌트 100명이어도 브리핑 비용은 1명분.

### 5.2 테넌트 레이어 (사이트별)

```
issue_products의 상품 URL → 각 테넌트 쿠팡 키로 딥링크 변환 (Deeplink API)
 ↓ site_product_links (site_id, product_id, deeplink, 실패 시 재시도 큐)
클릭/랭킹: 기존 tracking_links/click_events에 site_id 추가 — 사이트별 TOP 랭킹
스레드: 이슈당 자동 스레드 생성, site_id 스코프
노출 카테고리: 사이트 설정의 관심 카테고리로 필터
```

쿠팡 딥링크 API 호출량 = 테넌트 수 × 노출 상품 수. 레이트리밋 대응:
- 이슈당 노출 상품 TOP 10으로 제한
- 배치 변환(딥링크 API는 URL 배열 지원) + 실패 재시도 큐
- 기존 `coupang_search_locks` 패턴 재활용해 테넌트별 스로틀

### 5.3 페이지 구조 (모든 테넌트 공통 템플릿)

- `/` 홈: 오늘의 이슈 / 상품 TOP / 인기 스레드
- `/issue/{slug}`: AI 브리핑 + 원문 출처 링크 목록 + 관련 상품 TOP 10 + 스레드
- `/shop`, `/shop/{category}`: 카테고리 상품 나열
- `/rankings`: 오늘의 클릭 TOP / 급상승
- `/threads`, `/threads/{id}`
- 전 상품 모듈 하단 제휴 고지 자동 삽입 (쿠팡파트너스 필수 문구)

## 6. DB 설계 (Supabase — 기존 자산 재활용)

### 신규 테이블

```sql
create table sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  slug text not null unique,            -- /s/{slug}, {slug}.cujasa.com
  name text not null,
  custom_domain text unique,
  theme jsonb not null default '{}',    -- 컬러, 로고 텍스트
  categories text[] not null default '{}',
  coupang_access_key text not null,     -- 암호화 저장 (아래 7절)
  coupang_secret_key text not null,
  coupang_tracking_code text,
  status text not null default 'active' check (status in ('active','paused','suspended')),
  plan text not null default 'basic',
  created_at timestamptz default now()
);

create table issues (            -- 전역 공유
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  briefing text not null,        -- AI 생성 브리핑
  keywords text[] not null,
  category text,
  score numeric default 0,       -- 노출 순위용
  published_at timestamptz default now()
);

create table issue_sources (     -- 원문 링크 (전문 저장 안 함)
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references issues(id) on delete cascade,
  publisher text, title text, url text not null, published_at timestamptz
);

create table issue_products (    -- 전역 상품 후보 (메타만)
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references issues(id) on delete cascade,
  keyword text, product_name text, product_url text not null,
  image_url text, price integer, rank integer
);

create table site_product_links ( -- 테넌트별 딥링크
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  issue_product_id uuid references issue_products(id) on delete cascade,
  deeplink text,
  status text default 'pending' check (status in ('pending','ok','failed')),
  unique (site_id, issue_product_id)
);

create table site_threads (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  issue_id uuid references issues(id) on delete cascade,
  title text not null, body text, auto_generated boolean default true,
  created_at timestamptz default now()
);
```

### 기존 테이블 확장

- `tracking_links`, `click_events`에 `site_id uuid` 추가 → 사이트별 랭킹/통계 그대로 재활용
- `billing_products`에 사이트 플랜 상품 추가 (기존 Toss 빌링 흐름 그대로)
- RLS: `sites` 및 site_id 스코프 테이블 전부 소유자 정책 (기존 `migrate_rls_all_tables_20260705.sql` 패턴)

## 7. 보안 — 회원 쿠팡 키 취급

- **평문 저장 금지.** `pgcrypto` 또는 앱 레벨 AES-256-GCM(마스터 키는 Render env) 암호화.
- 클라이언트에는 키를 절대 반환하지 않음 — 마스킹(`AKXX****`)만.
- 딥링크 변환은 서버 사이드 전용. 키는 요청 시 복호화 → 메모리에서만 사용.
- 키 교체 UI 제공(재검증 포함), 삭제 시 사이트 paused.

## 8. 수익 모델

| 플랜 | 내용 | 과금 |
|---|---|---|
| Basic | 사이트 1개, `/s/{slug}`, 카테고리 3개, 일 이슈 N개 | 월 구독 (기존 Toss 빌링) |
| Pro | 서브도메인, 카테고리 무제한, 랭킹/통계 대시보드, 스레드 관리 | 월 구독 상위 |
| Add-on | 커스텀 도메인 연결 | 월/건 |

- 회원의 쿠팡 수익은 100% 회원 것 (자기 키니까) → 셀링 포인트: "네 수익은 네 통장으로".
- 운영자 수익 = 구독료. 수익쉐어 모델은 쿠팡 정산 API 접근이 회원 키 기반이라 검증 복잡 — MVP에서 배제.

## 9. 리스크와 대응

1. **쿠팡파트너스 정책**: 회원 각자 자기 파트너스 계정 승인 필요. 파트너스는 "본인 운영 매체 등록"을 요구 → 회원이 자기 발급 URL을 파트너스 매체로 등록하는 온보딩 가이드 필수. 생성 플로우 ②에서 안내.
2. **중복 콘텐츠 SEO**: 전 테넌트가 같은 브리핑이면 구글이 도메인 간 중복으로 판단할 수 있음.
   - 1차 방어: 테넌트별 카테고리 필터로 노출 조합 차별화
   - 2차: 브리핑 문체 variant 2~3종을 클러스터당 생성(비용 +2배지만 여전히 테넌트 수 무관)
   - 3차: canonical은 각 사이트 자기 URL로 (연합 아님을 명시)
   - 어차피 초기 트래픽은 SEO보다 회원 자신의 SNS 유통(기존 스레드 자동 포스팅 자산과 연결)이 주력.
3. **저작권**: 전문 미저장·브리핑+출처링크 원칙(직전 대화 합의) 전 테넌트 공통 강제. 고지 문구 자동 삽입.
4. **딥링크 API 쿼터**: 테넌트 증가 시 변환량 선형 증가 → 배치+재시도 큐+상품 수 상한으로 제어. 실패 상품은 해당 테넌트 화면에서 자동 숨김.
5. **악성 테넌트**: 발급 사이트에서 어뷰징 시 전체 도메인 평판 훼손 → `status='suspended'` 즉시 차단 스위치, 콘텐츠는 어차피 전역 통제라 테넌트가 임의 게시 불가(스레드만 모더레이션 대상).

## 10. 단계별 로드맵

### Phase 1 — 이슈 커머스 엔진 (공유 레이어)
- 뉴스 수집기(RSS 우선) + 클러스터링 + 브리핑 생성 크론 (기존 daily-pipeline에 신규 잡 추가)
- issues/issue_sources/issue_products 스키마 + 운영자 사이트(테넌트 #0)로 렌더링
- 이슈 페이지/샵/랭킹/스레드 프론트 템플릿

### Phase 2 — 사이트 팩토리
- sites 스키마 + 테넌트 해석 미들웨어 + `/s/{slug}` 라우팅
- [사이트 생성] 위저드 (키 검증 포함) + 딥링크 백필 큐
- 클릭 트래킹 site_id 스코프 + 사이트별 랭킹

### Phase 3 — 상용화
- Toss 빌링 플랜 연결, 사이트 상태 게이팅 (미결제 → paused)
- 서브도메인 와일드카드, 통계 대시보드
- 커스텀 도메인, 브리핑 variant, 쇼핑커넥트 2차 소스

### 성공 지표 (MVP)
- 생성 버튼 → 사이트 오픈까지 60초 이내
- 신규 사이트 첫 화면에 당일 이슈 ≥ 10개, 상품 ≥ 30개
- LLM 비용: 테넌트 수와 무관하게 일 고정
- 딥링크 변환 성공률 ≥ 95%
