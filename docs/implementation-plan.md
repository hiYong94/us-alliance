# 구현 계획 — Job 관리 시스템

## Context

`docs/requirements.md`, `docs/coding-style.md`, `docs/git-convention.md` 세 결정 문서가
완성된 상태에서 도메인 코드 구현을 시작한다. 현재 `src/` 는 NestJS 11 CLI 기본 스캐폴딩만
있고 도메인 코드는 0이다.

사용자는 *모든 작업을 작은 단위로 나누고 각각 별도 브랜치로 분기* 를 명시적으로 요구.
1인 3일 제약 안에서 PR + Merge commit 흐름(`docs/git-convention.md`)으로 main 에 통합한다.

목표: **20 브랜치 / 5 Phase** 로 분할된 실행 가능한 로드맵을 제시한다.

> 검토 반영 사항: enum UPPER_SNAKE_CASE / `@nestjs/config` 도입 / 공통 응답 DTO 추상화 /
> traceId 분산 환경 그룹핑 / Repository 영속성 분리 + `JobsMutex` provider /
> `RandomService` 추상화 / 도메인 예외 베이스 클래스 + type guard / eslint·prettier 도입

---

## Phase 1 — 기반 셋업

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 1 | `chore/install-dependencies` | 패키지 설치 | `package.json` — `@nestjs/schedule`, `@nestjs/config`, `node-json-db`, `async-mutex`, `class-validator`, `class-transformer`, `@nestjs/swagger`, `uuid`, `@types/uuid`, `eslint-plugin-unused-imports` | — |
| 2 | `chore/eslint-prettier-config` | 코드 스타일 도구 적용 | `.prettierrc` (singleQuote, semi, trailingComma all, printWidth 100, tabWidth 2), `eslint.config.mjs` (typescript-eslint recommendedTypeChecked + prettier/recommended + unused-imports), `package.json` lint·format scripts | 1 |
| 3 | `chore/cleanup-scaffold` | 스캐폴딩 잔재 제거 | `src/app.controller.ts` / `app.service.ts` / `app.controller.spec.ts` / `test/app.e2e-spec.ts` 삭제, `app.module.ts`·`main.ts` 최소화 | 2 |
| 4 | `chore/jobs-module-skeleton` | 모듈 골격 + 환경 변수 | `src/jobs/jobs.module.ts`, `src/common/`, `src/logging/logging.module.ts`, `src/config/app-config.module.ts` (`ConfigModule.forRoot({isGlobal:true})`), `app.module.ts` 에서 import | 3 |

---

## Phase 2 — 도메인 모델 · 응답 DTO

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 5 | `feat/job-entity-and-enums` | Job 인터페이스 + 2 enum (UPPER_SNAKE_CASE 멤버명·값 + 멤버 JSDoc) | `src/jobs/entities/job.ts` — `Job`, `JobStatus`, `TriggerSource` | 4 |
| 6 | `feat/common-response-dtos` | 공통 응답 envelope 추상화 | `src/common/dto/api-response.dto.ts` (`ApiResponse<T>`, `SingleResponse<T>`, `PaginatedResponse<T>`, `PaginationMeta`), `src/common/dto/error-response.dto.ts` (`ErrorResponse`) | 4 |
| 7 | `feat/job-dtos` | 입력 DTO + JobResponse + 꼼꼼한 `@ApiProperty` (description / example / required / nullable / type / length) | `src/jobs/dto/{create-job,patch-job,list-jobs.query,search-jobs.query,job.response}.ts` | 5 |
| 8 | `feat/job-domain-exceptions` | 추상 베이스 + 4종 예외 + type guard | `src/jobs/exceptions/job.exceptions.ts` — `DomainException` 추상 + `JobNotFound`/`JobNotEditable`/`JobAlreadyCanceled`/`JobAlreadyClaimed` + `isDomainException` | 5 |

---

## Phase 3 — Cross-cutting 인프라

도메인 로직 *전* 에 배치한다. 근거:

- `AllExceptionsFilter` 가 도메인 예외 코드를 매핑하려면 Phase 2 의 예외가 먼저 land 되어야 하고
- e2e 부터 envelope 일관성을 검증해야 평가 시점 설득력이 강화되며
- Phase 4 의 `feat/global-bootstrap` 이 Filter · Interceptor · Middleware 를 한꺼번에 묶음

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 9 | `feat/logger-service` | 일자 파티셔닝 JSON Lines 로거 (+ spec) | `src/logging/logger.service.ts` (+ `.spec.ts`) — `LOG_DIR` 은 `ConfigService` 로 조회, 자정 경계, 디렉토리 자동 생성, JSON 1줄 | 4 |
| 10 | `feat/trace-context` | traceId 미들웨어 + 데코레이터 + ALS | `src/common/middlewares/trace-context.middleware.ts`, `decorators/trace-id.decorator.ts`, `context/trace-context.ts` — `X-Trace-Id` inbound/outbound | 4 |
| 11 | `feat/logging-interceptor` | HTTP 요청·응답 로깅 (+ spec) | `src/common/interceptors/logging.interceptor.ts` (+ spec) — `getTraceId()` 포함 | 9, 10 |
| 12 | `feat/all-exceptions-filter` | 에러 envelope + 에러 로깅 (+ spec) | `src/common/filters/all-exceptions.filter.ts` (+ spec) — `ErrorResponse` 응답, `isDomainException` type guard | 6, 8, 9, 10 |

---

## Phase 4 — Persistence + 도메인 로직

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 13 | `feat/jobs-repository-with-mutex` | 영속성(CRUD) + 단일 mutex provider (+ spec) | `src/jobs/jobs.repository.ts` (CRUD only — `ConfigService` 에서 `JOBS_DB_PATH` 조회), `src/jobs/jobs.mutex.ts` (`JobsMutex.runExclusive`) (+ spec — claim 직렬화, lost update 차단) | 4, 5 |
| 14 | `feat/jobs-service` | 도메인 로직 (+ spec) | `src/jobs/jobs.service.ts` (+ spec — `JobsMutex.runExclusive` 안에서 검증 · 클레임 · 상태 전이, 검색 필터) | 7, 8, 13 |
| 15 | `feat/jobs-controller-and-swagger` | 6 엔드포인트 + envelope wrapper + `@ApiOperation`/`@ApiResponse` + `@ApiExtraModels` 등록 | `src/jobs/jobs.controller.ts`, `jobs.module.ts` 등록 | 14 |
| 16 | `feat/global-bootstrap` | main.ts 전역 셋업 | `src/main.ts` — `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`, `AllExceptionsFilter`, `LoggingInterceptor`, `TraceContextMiddleware`, Swagger `/docs` mount, `PORT` 는 `ConfigService` 조회 | 11, 12, 15 |

---

## Phase 5 — 스케줄러 + 검증 + 문서

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 17 | `feat/jobs-scheduler` | 스케줄러 + `RandomService` (+ spec) | `src/jobs/jobs.scheduler.ts`, `src/common/random.service.ts`, `jobs.module.ts`, `app.module.ts` (`ScheduleModule.forRoot()`). spec — `tick()` 직접 호출, `RandomService` 모킹으로 결정적 검증, `Promise.allSettled` 부분 실패 격리 | 13, 14 |
| 18 | `chore/sample-jobs-data` | 샘플 데이터 + .gitignore 예외 | `jobs.json` (각 status 골고루, UPPER_SNAKE_CASE 값), `.gitignore` | 16 |
| 19 | `test/e2e-and-concurrency` | e2e 정상 플로우 + 동시성 시나리오 2종 | `test/jobs.e2e-spec.ts`, `concurrency.e2e-spec.ts`, `jest-e2e.json` env 주입 | 16, 17 |
| 20 | `docs/readme-final` | 평가자용 README — 실행법 / Swagger 위치 / 동시성 전략 / 명세 해석 / 회고 | `README.md` (Nest 기본 교체), 필요시 `CLAUDE.md` 동기화 | 모든 feat |

---

## 의존성 다이어그램

```
1 install
└─ 2 eslint-prettier
   └─ 3 cleanup
      └─ 4 skeleton (config 모듈 포함)
         ├─ 5 entity-and-enums ──┬─ 7 job-dtos
         │                       └─ 8 domain-exceptions
         ├─ 6 common-response-dtos ─────────┐
         ├─ 9 logger ──┬─ 11 interceptor    │
         └─ 10 trace ──┴─ 12 filter (+6,+8) ┘

5,7,8,4 → 13 repo+mutex → 14 service → 15 controller
11,12,15 → 16 bootstrap
13,14 → 17 scheduler (+random)
16 → 18 sample
16,17 → 19 e2e
19 → 20 readme
```

병렬 가능 구간: `{5, 6, 9, 10}` · `{7, 8}` · `{11, 12}` · `{17, 18}`

---

## 핵심 의사결정

### 테스트 분배 — 단위는 feat 동봉, e2e + 동시성은 별도 브랜치

- **단위**: 각 feat 브랜치 안에 `<name>.spec.ts` 동봉. PR 하나가 자기 책임을 검증 → 회귀 위험 ↓, `coding-style.md §7` 디렉토리 구조와 정합
- **e2e + 동시성**: 여러 컴포넌트를 가로지르므로 단일 feat 책임 초과. 평가자가 *시연 가능성* 위주로 한 PR 에서 보기에 유리

### Repository 와 mutex 분리

`JobsRepository` 는 영속성(CRUD)만, `JobsMutex` 는 동시성 정책의 단일 진입점.
Service · Scheduler 가 같은 `JobsMutex` 인스턴스를 주입받아 read-modify-write 를 직렬화.

### 도구 강제 — Lint · Format

`chore/eslint-prettier-config` 를 Phase 1 둘째에 배치하여 *이후 모든 feat 브랜치가 같은
포매팅 · lint 룰* 위에서 작성되도록 한다. 도구 도입을 뒤로 미루면 일괄 포매팅 diff 가 PR 리뷰
노이즈가 된다.

### 일정 가이드 (참고)

- **D1**: Phase 1 + 2 + 3 (12 브랜치) — 인프라 집중일
- **D2**: Phase 4 + #17 (5 브랜치) — 도메인 본체
- **D3**: #18, #19, #20 (3 브랜치) + 회귀 보정 여유

### 위험 요소

1. **#13 mutex 단위 테스트** — race 재현은 `Promise.all` + 인공 지연 spy 필요. 가장 까다로움
2. **#16 land 시 결함 폭로** — Phase 4 진행 중에도 supertest 또는 수동 curl 한 번 권장
3. **#17 스케줄러 시간 의존** — `tick()` 직접 호출 + `RandomService` 모킹으로 우회 (Cron 시간 모킹 X)

---

## 작성될 파일 트리

```
src/
├── main.ts                                            (#16)
├── app.module.ts                                      (#4, #16, #17)
├── config/
│   └── app-config.module.ts                           (#4)
├── jobs/
│   ├── jobs.module.ts                                 (#4, #13~#15, #17)
│   ├── jobs.controller.ts                             (#15)
│   ├── jobs.service.ts                                (#14)
│   ├── jobs.repository.ts                             (#13, CRUD only)
│   ├── jobs.mutex.ts                                  (#13)
│   ├── jobs.scheduler.ts                              (#17)
│   ├── dto/
│   │   ├── create-job.dto.ts                          (#7)
│   │   ├── patch-job.dto.ts                           (#7)
│   │   ├── list-jobs.query.ts                         (#7)
│   │   ├── search-jobs.query.ts                       (#7)
│   │   └── job.response.ts                            (#7)
│   ├── entities/job.ts                                (#5)
│   └── exceptions/job.exceptions.ts                   (#8)
├── common/
│   ├── dto/
│   │   ├── api-response.dto.ts                        (#6)
│   │   └── error-response.dto.ts                      (#6)
│   ├── context/trace-context.ts                       (#10)
│   ├── interceptors/logging.interceptor.ts            (#11)
│   ├── filters/all-exceptions.filter.ts               (#12)
│   ├── middlewares/trace-context.middleware.ts        (#10)
│   ├── decorators/trace-id.decorator.ts               (#10)
│   └── random.service.ts                              (#17)
└── logging/
    ├── logging.module.ts                              (#4, #9)
    └── logger.service.ts                              (#9)

test/
├── jobs.e2e-spec.ts                                   (#19)
├── concurrency.e2e-spec.ts                            (#19)
└── jest-e2e.json                                      (#19 env 주입)

루트:
├── .prettierrc                                        (#2 갱신)
├── eslint.config.mjs                                  (#2 갱신)
├── jobs.json                                          (#18)
└── README.md                                          (#20)
```

---

## 검증 방법 (end-to-end)

각 phase 완료 시점에 다음을 확인한다.

- **Phase 1 종료**: `npm run lint && npm run build` 무에러
- **Phase 2 종료**: TypeScript 컴파일 통과 (`tsc --noEmit`)
- **Phase 3 종료**: 각 feat 의 `*.spec.ts` 통과 (`npm test`)
- **Phase 4 #16 종료**:
  1. `npm run start:dev` 부팅 무에러
  2. `curl localhost:3000/docs` → Swagger UI 응답
  3. `curl -X POST localhost:3000/jobs -H 'Content-Type: application/json' -d '{"title":"t1"}'` → 201, `{ data: ... }` envelope, `X-Trace-Id` 응답 헤더 존재
  4. `curl localhost:3000/jobs` → `{ data, meta }` envelope
  5. 잘못된 PATCH (예: 존재하지 않는 ID) → `{ statusCode, code, message, ... }` 에러 envelope
- **Phase 5 #17 종료**: 부팅 5초 후 `logs/<오늘>.log` 에 `tick.start` 항목 등장
- **Phase 5 #19 종료**: `npm run test:e2e` 그린
- **Phase 5 #20 종료**: README 실행 가이드대로 따라 Swagger UI + 샘플 데이터 조회 동작

전체 회귀 게이트: `npm run lint && npm test && npm run test:e2e && npm run build` 모두 그린.

---

## 작업 흐름 (각 브랜치마다)

1. `git checkout main && git pull origin main`
2. `git checkout -b <type>/<short-description>`
3. 코드 작성 + 단위 테스트 (해당하는 경우)
4. `npm run lint && npm test` 통과 확인
5. 컨벤션에 맞춘 커밋 (트레일러 없음, `<type>: <제목>` ≤50자)
6. `git push -u origin <branch>`
7. GitHub UI 에서 PR 생성 (제목 = 커밋 메시지, 본문 = `docs/git-convention.md` 템플릿)
8. PR Merge commit 으로 main 통합
9. 다음 브랜치로
