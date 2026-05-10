# 구현 계획 — Job 관리 시스템

## Context

`docs/requirements.md`, `docs/coding-style.md`, `docs/git-convention.md` 세 결정 문서가
완성된 상태에서 도메인 코드 구현을 시작한다. 현재 `src/` 는 NestJS 11 CLI 기본 스캐폴딩만
있고 도메인 코드는 0이다.

사용자는 *모든 작업을 작은 단위로 나누고 각각 별도 브랜치로 분기* 를 명시적으로 요구.
1인 3일 제약 안에서 PR + Merge commit 흐름(`docs/git-convention.md`)으로 main 에 통합한다.

목표: **18 브랜치 / 5 Phase** 로 분할된 실행 가능한 로드맵을 제시한다.

---

## Phase 1 — 기반 셋업

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 1 | `chore/install-dependencies` | 패키지 설치 | `package.json` — `@nestjs/schedule`, `node-json-db`, `async-mutex`, `class-validator`, `class-transformer`, `@nestjs/swagger`, `uuid`, `@types/uuid` | — |
| 2 | `chore/cleanup-scaffold` | 스캐폴딩 잔재 제거 | `src/app.controller.ts` / `app.service.ts` / `app.controller.spec.ts` / `test/app.e2e-spec.ts` 삭제, `app.module.ts`·`main.ts` 최소화 | 1 |
| 3 | `chore/jobs-module-skeleton` | 빈 도메인 모듈 골격 | `src/jobs/jobs.module.ts`, `src/common/` 디렉토리, `src/logging/logging.module.ts`, `app.module.ts` import | 2 |

---

## Phase 2 — 도메인 모델

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 4 | `feat/job-entity-and-enums` | 타입 + 2 enum | `src/jobs/entities/job.ts` — `Job`, `JobStatus`, `TriggerSource` | 3 |
| 5 | `feat/job-dtos` | 입력 DTO + class-validator + `@ApiProperty` | `src/jobs/dto/{create-job,patch-job,list-jobs.query,search-jobs.query}.dto.ts` | 4 |
| 6 | `feat/job-domain-exceptions` | 4종 도메인 예외 | `src/jobs/exceptions/job.exceptions.ts` — `JobNotFound`, `JobNotEditable`, `JobAlreadyCanceled`, `JobAlreadyClaimed` | 4 |

---

## Phase 3 — Cross-cutting 인프라

도메인 로직 *전* 에 배치한다. 근거:

- `AllExceptionsFilter` 가 도메인 예외 코드를 매핑하려면 Phase 2 의 예외가 먼저 land 되어야 하고
- e2e 부터 envelope 일관성을 검증해야 평가 시점 설득력이 강화되며
- Phase 4 의 `feat/global-bootstrap` 이 Filter · Interceptor · Middleware 를 한꺼번에 묶음

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 7 | `feat/logger-service` | 일자 파티셔닝 JSON Lines 로거 (+ spec) | `src/logging/logger.service.ts` (+ `.spec.ts`) — 자정 경계, 디렉토리 자동 생성, JSON 1줄 | 3 |
| 8 | `feat/request-id-context` | requestId 미들웨어 + 데코레이터 + ALS | `src/common/middlewares/request-id.middleware.ts`, `decorators/request-id.decorator.ts`, `context/request-context.ts` | 3 |
| 9 | `feat/logging-interceptor` | HTTP 요청·응답 로깅 (+ spec) | `src/common/interceptors/logging.interceptor.ts` (+ spec) | 7, 8 |
| 10 | `feat/all-exceptions-filter` | 에러 envelope + 에러 로깅 (+ spec) | `src/common/filters/all-exceptions.filter.ts` (+ spec) | 6, 7, 8 |

---

## Phase 4 — Persistence + 도메인 로직

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 11 | `feat/jobs-repository-with-mutex` | node-json-db + `runExclusive` (+ spec) | `src/jobs/jobs.repository.ts` (+ spec — claim 직렬화, lost update 차단, soft-delete 필터) | 4, 6 |
| 12 | `feat/jobs-service` | 도메인 로직 (+ spec) | `src/jobs/jobs.service.ts` (+ spec — 상태 전이 매트릭스, 검색 필터) | 5, 11 |
| 13 | `feat/jobs-controller-and-swagger` | 6 엔드포인트 + envelope + `@ApiOperation`/`@ApiResponse` | `src/jobs/jobs.controller.ts`, `jobs.module.ts` 등록 | 12 |
| 14 | `feat/global-bootstrap` | main.ts 전역 셋업 | `src/main.ts` — `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`, `AllExceptionsFilter`, `LoggingInterceptor`, requestId 미들웨어, Swagger `/docs` mount | 9, 10, 13 |

---

## Phase 5 — 스케줄러 + 검증 + 문서

| # | Branch | 목적 | 주요 변경 | 의존 |
|---|---|---|---|---|
| 15 | `feat/jobs-scheduler` | `@Cron` + `@Timeout` + `processOne` (+ spec) | `src/jobs/jobs.scheduler.ts`, `jobs.module.ts`, `app.module.ts` (`ScheduleModule.forRoot()`) | 11, 12 |
| 16 | `chore/sample-jobs-data` | 샘플 데이터 + .gitignore 예외 | `jobs.json`, `.gitignore` | 14 |
| 17 | `test/e2e-and-concurrency` | e2e 정상 플로우 + 동시성 시나리오 2종 | `test/jobs.e2e-spec.ts`, `concurrency.e2e-spec.ts`, `jest-e2e.json` env 주입 | 14, 15 |
| 18 | `docs/readme-final` | 평가자용 README — 실행법 / Swagger 위치 / 동시성 전략 / 명세 해석 / 회고 | `README.md` (Nest 기본 교체), 필요시 `CLAUDE.md` 동기화 | 모든 feat |

---

## 의존성 다이어그램

```
1 install
└─ 2 cleanup
   └─ 3 skeleton
      ├─ 4 entity ──┬─ 5 dtos
      │             └─ 6 exceptions
      ├─ 7 logger ──┬─ 9 interceptor
      └─ 8 req-id ──┴─ 10 filter (+ 6)

4,6 → 11 repo → 12 service → 13 controller
9,10,13 → 14 bootstrap
11,12 → 15 scheduler
14 → 16 sample
14,15 → 17 e2e
17 → 18 readme
```

병렬 가능 구간: `{4, 7, 8}` · `{5, 6}` · `{9, 10}` · `{15, 16}`

---

## 핵심 의사결정

### 테스트 분배 — 단위는 feat 동봉, e2e + 동시성은 별도 브랜치

- **단위**: 각 feat 브랜치 안에 `<name>.spec.ts` 동봉. PR 하나가 자기 책임을 검증 → 회귀 위험 ↓, `coding-style.md §7` 디렉토리 구조와 정합
- **e2e + 동시성**: 여러 컴포넌트를 가로지르므로 단일 feat 책임 초과. 평가자가 *시연 가능성* 위주로 한 PR 에서 보기에 유리

### 일정 가이드 (참고)

- **D1**: Phase 1 + 2 + 3 (10 브랜치) — 인프라 집중일
- **D2**: Phase 4 + #15 (5 브랜치) — 도메인 본체
- **D3**: #16, #17, #18 (3 브랜치) + 회귀 보정 여유

### 위험 요소

1. **#11 mutex 단위 테스트** — race 재현은 `Promise.all` + 인공 지연 spy 필요. 가장 까다로움
2. **#14 land 시 결함 폭로** — Phase 4 진행 중에도 supertest 또는 수동 curl 한 번 권장
3. **#15 스케줄러 시간 의존** — `tick()` 직접 호출 + `Math.random` 모킹으로 우회 (Cron 시간 모킹 X)

---

## 작성될 파일 트리

```
src/
├── main.ts                                       (#14)
├── app.module.ts                                 (#3, #14, #15)
├── jobs/
│   ├── jobs.module.ts                            (#3, #11~#13, #15)
│   ├── jobs.controller.ts                        (#13)
│   ├── jobs.service.ts                           (#12)
│   ├── jobs.repository.ts                        (#11)
│   ├── jobs.scheduler.ts                         (#15)
│   ├── dto/
│   │   ├── create-job.dto.ts                     (#5)
│   │   ├── patch-job.dto.ts                      (#5)
│   │   ├── list-jobs.query.ts                    (#5)
│   │   └── search-jobs.query.ts                  (#5)
│   ├── entities/job.ts                           (#4)
│   └── exceptions/job.exceptions.ts              (#6)
├── common/
│   ├── interceptors/logging.interceptor.ts       (#9)
│   ├── filters/all-exceptions.filter.ts          (#10)
│   ├── middlewares/request-id.middleware.ts      (#8)
│   ├── decorators/request-id.decorator.ts        (#8)
│   └── context/request-context.ts                (#8)
└── logging/
    ├── logging.module.ts                         (#3, #7)
    └── logger.service.ts                         (#7)

test/
├── jobs.e2e-spec.ts                              (#17)
├── concurrency.e2e-spec.ts                       (#17)
└── jest-e2e.json                                 (#17 env 주입)

루트:
├── jobs.json                                     (#16)
└── README.md                                     (#18)
```

---

## 검증 방법 (end-to-end)

각 phase 완료 시점에 다음을 확인한다.

- **Phase 1 종료**: `npm run build` 무에러
- **Phase 2 종료**: TypeScript 컴파일 통과 (`tsc --noEmit`)
- **Phase 3 종료**: 각 feat 의 `*.spec.ts` 통과 (`npm test`)
- **Phase 4 #14 종료**:
  1. `npm run start:dev` 부팅 무에러
  2. `curl localhost:3000/docs` → Swagger UI 응답
  3. `curl -X POST localhost:3000/jobs -H 'Content-Type: application/json' -d '{"title":"t1"}'` → 201, `{ data: ... }` envelope
  4. `curl localhost:3000/jobs` → `{ data, meta }` envelope
  5. 잘못된 PATCH (예: 존재하지 않는 ID) → `{ statusCode, code, message, ... }` 에러 envelope
- **Phase 5 #15 종료**: 부팅 5초 후 `logs/<오늘>.log` 에 `tick.start` 항목 등장
- **Phase 5 #17 종료**: `npm run test:e2e` 그린
- **Phase 5 #18 종료**: README 실행 가이드대로 따라 Swagger UI + 샘플 데이터 조회 동작

전체 회귀 게이트: `npm test && npm run test:e2e && npm run build` 모두 그린.

---

## 작업 흐름 (각 브랜치마다)

1. `git checkout main && git pull origin main`
2. `git checkout -b <type>/<short-description>`
3. 코드 작성 + 단위 테스트 (해당하는 경우)
4. `npm test` 통과 확인
5. 컨벤션에 맞춘 커밋 (트레일러 없음, `<type>: <제목>` ≤50자)
6. `git push -u origin <branch>`
7. GitHub UI 에서 PR 생성 (제목 = 커밋 메시지, 본문 = `docs/git-convention.md` 템플릿)
8. PR Merge commit 으로 main 통합
9. 다음 브랜치로
