# 어스얼라이언스 백엔드 엔지니어 채용 과제 — Job 관리 시스템

NestJS · TypeScript 로 작업(Job) 라이프사이클을 관리하는 백엔드. RESTful API 로
생성·조회·검색·수정·취소·수동 실행을 제공하고, 백그라운드 스케줄러가 PENDING 작업을 주기적으로
점유·처리한다. 데이터는 단일 JSON 파일(`jobs.json`) 에 영속화한다.

---

## 빠른 시작

```bash
npm install
npm run start:dev       # http://localhost:3000  + Swagger /docs
```

| 명령                                                     | 결과                                   |
| -------------------------------------------------------- | -------------------------------------- |
| `npm test`                                               | 단위 64 케이스                         |
| `npm run test:e2e`                                       | e2e 17 케이스                          |
| `npm run lint`                                           | typescript-eslint + prettier 자동 수정 |
| `npm run build`                                          | dist/ 생성                             |

회귀 게이트 한 줄: `npm run lint && npm test && npm run test:e2e && npm run build`

---

## API

부팅 후 **http://localhost:3000/docs** 에서 Swagger UI 로 6 엔드포인트의 요청·응답·에러 스키마를
즉시 확인할 수 있다.

| Method  | Path            | 설명                                     | 응답 코드             |
| ------- | --------------- | ---------------------------------------- | --------------------- |
| `POST`  | `/jobs`         | 생성                                     | 201 / 400             |
| `GET`   | `/jobs`         | 목록 (createdAt desc, soft-deleted 제외) | 200                   |
| `GET`   | `/jobs/search`  | 검색 (title 부분일치 + status 다중)      | 200                   |
| `GET`   | `/jobs/:id`     | 단건 (soft-deleted 는 404)               | 200 / 404             |
| `PATCH` | `/jobs/:id`     | 수정 또는 취소                           | 200 / 400 / 404 / 409 |
| `POST`  | `/jobs/:id/run` | **수동 실행 트리거 (명세 외 추가)**      | 200 / 404 / 409       |

### 응답 / 에러 형식

모든 성공 응답은 `{ data: ... }` 또는 `{ data: [...], meta: { total, limit, offset } }` 형태로
감싼다 (`SingleResponse<T>` / `PaginatedResponse<T>`).

모든 에러 응답은 다음 통일된 형식을 따른다 (`ErrorResponse`):

```json
{
  "statusCode": 409,
  "code": "JOB_NOT_EDITABLE",
  "message": "PENDING 상태가 아닌 작업은 수정할 수 없습니다 (현재: PROCESSING)",
  "timestamp": "2026-05-11T12:00:00.000Z",
  "path": "/jobs/abc-123"
}
```

**도메인 에러 코드**: `JOB_NOT_FOUND` · `JOB_NOT_EDITABLE` · `JOB_ALREADY_CANCELED` ·
`JOB_ALREADY_CLAIMED` · `VALIDATION_FAILED`. 분류되지 않는 예외는 500 으로 떨어뜨려 신규
도메인 코드로 승격하는 정책 (catch-all 미사용).

### 요청 / 응답 예시

**POST /jobs**

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title":"데이터 백업","description":"매일 자정 S3 업로드"}'
```

```json
{
  "data": {
    "id": "5f3e7c8a-1b2d-4e5f-6789-0123456789ab",
    "title": "데이터 백업",
    "description": "매일 자정 S3 업로드",
    "status": "PENDING",
    "triggeredBy": null,
    "createdAt": "2026-05-11T12:34:56.789Z",
    "updatedAt": "2026-05-11T12:34:56.789Z",
    "deletedAt": null
  }
}
```

응답 헤더에 `X-Trace-Id` 가 포함되어 요청과 로그를 연결할 수 있다.

**PATCH /jobs/:id (취소)**

```bash
curl -X PATCH http://localhost:3000/jobs/5f3e7c8a-... \
  -H 'Content-Type: application/json' \
  -d '{"cancel":true}'
```

`deletedAt` 이 set 되고 status 는 `PENDING` 그대로. 후속 `GET /jobs/:id` 는 404 (목록·단건 일관).

**POST /jobs/:id/run (수동 실행)**

다음 스케줄러 tick (매분 0초) 을 기다리지 않고 즉시 점유. 처리(sleep + done/failed) 는 비동기로
진행되며 응답은 PROCESSING 상태로 즉시 반환.

**검색 — 다중 조건**

```bash
curl 'http://localhost:3000/jobs/search?title=백업&status=PENDING,FAILED&limit=10'
```

---

## 설계 결정 (의도된 부분)

### 1. 동시성 전략 — Service 레이어 단일 mutex

`async-mutex` 의 `Mutex` 인스턴스를 `JobsMutex` provider 로 감싸 단일 인스턴스 주입. Service 와
Scheduler 의 모든 read-modify-write 가 이 mutex 의 `runExclusive` 를 통과한다.

- **왜 in-process mutex 만 두는가**: 본 과제 저장소(node-json-db) 가 단일 파일·단일 프로세스 가정.
  분산 환경 도입은 _저장소 교체_ 가 선행되어야 하므로 본 구현 범위 밖. 단일 프로세스에서 가능한
  가장 단순하고 확실한 방어.
- **왜 Repository 가 아닌 Service 에 mutex**: 영속성과 동시성 정책의 책임을 분리. Repo 는
  CRUD 만 — 테스트 fixture, 마이그레이션 등 다른 컨텍스트에서 락 없이 재사용 가능.

### 2. 취소 = soft-delete (별도 상태 없음)

명세에 DELETE 엔드포인트가 없어 `PATCH /jobs/:id` 본문에 `cancel: true` 액션 플래그를 둠.
`deletedAt` 에 시각이 set 되며 status 는 그대로 PENDING. 스케줄러 · 수동 실행 모두
`deletedAt is not null` 인 작업은 후보에서 제외. 별도 `CANCELED` 상태를 두지 않아 상태 집합과
전이 매트릭스가 작다.

### 3. 명세 외 `POST /jobs/:id/run` 추가

수동 실행 트리거. 명세에 없는 6번째 엔드포인트.

- **추가 사유**: 수동·자동 두 트리거 경로가 _같은 mutex 를 통과_ 하는 시나리오를 자연스럽게 시연.
  동시성 평가 포인트(스케줄러 ↔ PATCH 경합, 동시 run 경합) 를 e2e 테스트뿐 아니라 실제 API 로
  검증 가능.
- **트레이드오프**: 엔드포인트 5 → 6. 평가자에게 "왜 추가했는가" 질문이 자연스러움.

### 4. 일자 파티셔닝 JSON Lines 로깅 (명세 해석)

명세는 `logs.txt` 단일 파일 명시. 본 구현은 **용량·가독성 관리** 목적으로 `logs/<YYYY-MM-DD>.log`
일자별 디렉토리 파티셔닝으로 해석. JSON Lines 포맷 (한 줄 = 한 항목) 으로 `tail -f | jq` 친화적.

매 항목에 `traceId` 포함. `LoggerService.append` 가 `trace-context` AsyncLocalStorage 에서
자동 주입한다 — HTTP 요청 단위 traceId 와 스케줄러 tick 단위 `tick-<uuid>` 모두 같은
메커니즘으로 그룹핑된다.

### 5. 분산 환경 대비 traceId

`X-Trace-Id` 헤더를 inbound 에서 수신하면 그대로 사용 (cross-service 그룹핑), 없으면 UUID 생성.
응답에도 동일 헤더 set 하여 클라이언트가 자신의 요청을 추적 가능.

본 과제는 단일 프로세스이지만 traceId 를 표준 필드로 두어 향후 분산 환경 확장 시 외부 trace
시스템(OpenTelemetry, W3C `traceparent`) 과의 통합 비용을 낮춘다.

### 6. 응답 형식 추상화

`ApiResponse<T>` 추상 베이스 + `SingleResponse<T>` / `PaginatedResponse<T>` 구체 클래스. 모든
엔드포인트가 `data` 필드를 가진다는 계약을 타입 시스템에 강제하고, Swagger 스키마를
`@ApiExtraModels` + `getSchemaPath` + `allOf` 패턴으로 결합.

### 7. AOP 위임

| 관심사           | 메커니즘                                                       | 위치                      |
| ---------------- | -------------------------------------------------------------- | ------------------------- |
| 입력 유효성      | `ValidationPipe(whitelist · forbidNonWhitelisted · transform)` | `main.ts`                 |
| 요청 추적        | `TraceContextMiddleware` + AsyncLocalStorage                   | `app.module.ts` configure |
| 요청 로깅        | `LoggingInterceptor` (성공)                                    | `APP_INTERCEPTOR`         |
| 에러 응답 + 로깅 | `AllExceptionsFilter`                                          | `APP_FILTER`              |
| 스케줄링         | `@Cron` / `@Timeout`                                           | `JobsScheduler`           |

Controller · Service 는 비기능 관심사 코드를 일절 들고 있지 않다.

---

## 명세 해석 노트

| 명세 항목                             | 본 구현의 해석                                                             | 사유                                             |
| ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| `logs.txt` 단일 파일                  | `logs/<date>.log` 일자별 파티셔닝                                          | 용량 · 가독성 관리                               |
| "처리" 의 의미 미정의                 | 1~3초 sleep + 10% 시뮬레이션 실패                                          | 상태 전이(`PENDING/PROCESSING/DONE/FAILED`) 시연 |
| DELETE 엔드포인트 없음                | PATCH `cancel: true` + soft-delete                                         | 명세 범위 안에서 라이프사이클 종료 표현          |
| 스케줄러 주기 자유                    | 매분 0초 (`@Cron('0 * * * * *')`) + 부팅 5초 후 첫 tick (`@Timeout(5000)`) | 명세 예시 + 시연성                               |
| 한 번에 처리할 단위 자유              | 5건 (`BATCH_SIZE`)                                                         | 단일 프로세스 부하 분산                          |
| `description` 의 PATCH 시 null 클리어 | 미지원 (`@IsString` 거부)                                                  | 본 과제 범위 외 — 회고 항목                      |

---

## 동시성 보장 시나리오

`docs/requirements.md §4.4` 의 표를 e2e 테스트(`test/concurrency.e2e-spec.ts`) 가 검증한다.

| 시나리오                   | 결과                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| 동시 PATCH (같은 ID 두 건) | 직렬화. 두 번째는 첫 번째 결과 위에서 진행 — 변경 모두 보존                   |
| 스케줄러 점유 ↔ PATCH      | 한 쪽만 성공, 다른 쪽 `JOB_NOT_EDITABLE` 또는 `JOB_ALREADY_CLAIMED`           |
| 동시 수동 실행 두 건       | 한 쪽만 성공, 다른 쪽 `JOB_ALREADY_CLAIMED`                                   |
| 동시 cancel + 점유         | 선후 따라 `JOB_ALREADY_CANCELED` 또는 `JOB_NOT_EDITABLE`                      |
| 1분 안에 tick 미종료       | `running` flag 로 다음 tick skip                                              |
| **멀티 프로세스 환경**     | **본 전략 보호 불가** — 외부 락(Redis Redlock) 또는 낙관적 락 필요. 회고 항목 |

---

## 디렉토리 · 모듈 구조

```
src/
├── main.ts                              전역 부트스트랩 (ValidationPipe, Swagger, ConfigService PORT)
├── app.module.ts                        APP_FILTER · APP_INTERCEPTOR · ScheduleModule 등록
├── config/app-config.module.ts          ConfigModule.forRoot({isGlobal: true})
├── jobs/                                도메인
│   ├── jobs.controller.ts               6 엔드포인트 + 응답 wrapper + Swagger
│   ├── jobs.service.ts                  검증 · 상태 전이 · mutex 직렬화
│   ├── jobs.repository.ts               영속성 only (node-json-db)
│   ├── jobs.mutex.ts                    JobsMutex provider — async-mutex wrapper
│   ├── jobs.scheduler.ts                @Cron + @Timeout + processOne
│   ├── jobs.module.ts                   모듈 등록
│   ├── dto/                             CreateJobDto · PatchJobDto · ListJobsQuery · SearchJobsQuery · JobResponse
│   ├── entities/job.ts                  Job 인터페이스 + JobStatus · TriggerSource enum
│   └── exceptions/job.exceptions.ts     DomainException 베이스 + 4종 + isDomainException
├── common/                              cross-cutting
│   ├── dto/                             ApiResponse · SingleResponse · PaginatedResponse · ErrorResponse
│   ├── context/trace-context.ts         AsyncLocalStorage
│   ├── middlewares/trace-context.middleware.ts
│   ├── interceptors/logging.interceptor.ts
│   ├── filters/all-exceptions.filter.ts
│   └── random.service.ts                Math.random 의 DI wrapper (테스트 결정성)
└── logging/
    ├── logger.service.ts                일자 파티셔닝 + traceId 자동 주입
    └── logging.module.ts

test/
├── jobs.e2e-spec.ts                     6 엔드포인트 + 검색/페이지네이션 + 에러 응답
└── concurrency.e2e-spec.ts              동시 PATCH · 동시 run · cancel↔run 경합

docs/
├── requirements.md                      도메인 · API · 동시성 · 로깅 · 테스트 · AOP · 명세 해석
├── coding-style.md                      JSDoc · 주석 · 명명 · brace · enum 등 컨벤션
├── git-convention.md                    브랜치 · 커밋 · PR 흐름
├── implementation-plan.md               20 브랜치 / 5 Phase 로드맵
└── local-test-scenario.md               수동 검증 체크리스트
```

---

## 테스트 전략

| 계층     | 위치                                                     | 케이스 |
| -------- | -------------------------------------------------------- | ------ |
| 단위     | `src/**/*.spec.ts`                                       | 64     |
| e2e      | `test/jobs.e2e-spec.ts` · `test/concurrency.e2e-spec.ts` | 17     |
| **합계** |                                                          | **81** |

설계 원칙 (적용 후 정리):

1. **독립성** — 각 spec 의 `beforeEach` 가 `mkdtempSync` 로 임시 디렉토리 + 환경변수 격리
2. **깨지기 쉬운 테스트 회피** — 라이브러리 동작 · mirror · trivial 케이스를 의도적으로 제거
3. **핵심 로직 우선** — 상태 전이 매트릭스 · 동시성 시나리오 · 응답 형식 일관성
4. **Given-When-Then** — 복잡 시나리오에만 명시적 라벨링 (5 케이스)
5. **간결성** — 90 → 81 케이스로 신호/노이즈 비 개선

스케줄러는 e2e 에서 `JobsScheduler` 를 mock 으로 `overrideProvider` 하여 cron 발화를 차단.
스케줄러 자체 로직은 `jobs.scheduler.spec.ts` 의 단위 테스트가 `tick()` 직접 호출 + `RandomService`
모킹으로 결정적 검증.

---

## 회고

### 고민했던 지점

**동시성 모델 선택 — mutex / 낙관적 락 / 외부 락**

세 가지 옵션 모두 가능했다.

- **mutex** (선택): 단일 프로세스에서 가장 단순·확실. node-json-db 의 단일 파일 가정과 정합.
- **낙관적 락** (`version` 필드): 멀티 프로세스 확장에 유리하나 PATCH 인터페이스에 version 을
  노출해야 함. 본 과제 범위에선 외부 API 부담 ↑.
- **외부 락** (Redis Redlock): 진짜 분산 환경 솔루션. 인프라 의존 + 본 과제 저장소(JSON 파일)
  와 부조화.

mutex 선택. 단, README 와 `docs/requirements.md §4.4` 에 _멀티 프로세스 환경에선 보호 불가_
한계를 명시.

**명세 외 엔드포인트 추가 여부**

`POST /jobs/:id/run` 을 추가할지 고민. 명세 위반 가능성 vs 동시성 시연 가치.

추가 결정 — _수동·자동 트리거가 같은 mutex 를 통과_ 하는 흐름을 외부 API 로도 노출하는 것이
동시성 평가 포인트의 설득력을 강화한다고 판단. 트레이드오프(평가자가 "왜 추가했냐" 질문 가능)
는 `docs/requirements.md §8 명세 해석` 에 사전 답변.

**`logs.txt` 단일 파일 vs 일자 파티셔닝**

명세는 단일 파일. 본 구현은 일자 디렉토리로 해석. 평가자가 _명세 위반_ 으로 볼 가능성과
_용량·가독성 향상_ 가치 사이의 판단.

일자 파티셔닝 채택 + 명세 해석 절에 사유 명시. 운영 관점에서 단일 파일은 빠르게 무거워져
실용성 떨어진다는 것이 결정 근거.

### 잘못 선택했다가 되돌린 결정

**1. 응답 코드 — `POST /jobs/:id/run` 을 202 → 200**

초기에 비동기 처리 시작을 의미하는 `202 Accepted` 로 설계. 검토 중 다른 엔드포인트가 모두
200/201 인데 한 엔드포인트만 202 이면 _일관성 약화_ 라는 점을 깨달아 200 으로 통일. 응답
본문에 `status: "PROCESSING"` 이 이미 비동기 진행을 표현하므로 202 의 추가 의미가 약함.

**2. `JOB_INVALID_STATUS_TRANSITION` catch-all 코드 제거**

초기 에러 코드 1차안에 catch-all 형태로 포함. _"모든 예외는 명시적으로 처리"_ 정책으로 정리하여
제거. 분류되지 않는 예외는 500 으로 떨어뜨려 신규 도메인 코드로 승격하는 정책.

**3. `withLock` 헬퍼 함수 → `runExclusive` 직접 사용**

mutex 를 한 겹 더 감싸는 헬퍼를 검토했으나, 본 과제 규모에서 추상화 비용 대비 이득이 작다고
판단. `async-mutex` 의 네이티브 API 인 `runExclusive` 를 직접 호출해 _배타 실행_ 의 의미가
코드에서 즉시 읽히도록 변경.

**4. "envelope" 영어 표현 제거**

응답 형식을 "envelope" 으로 표현했으나 _불필요한 영어 표기_ 임을 발견해 코드와 문서에서
"응답" / "응답 형식" 으로 일괄 교체.

**5. 도메인 enum 의 값까지 UPPER_SNAKE_CASE 통일**

초기에 멤버명만 UPPER, 값은 lowercase 로 설계. 이후 _멤버명·값 모두 UPPER_SNAKE_CASE_ 로
통일. API 표면(검색 쿼리·JSON·로그) 에 노출되는 일관성 확보.

**6. LoggerService 의 `traceId` 명시 vs 자동 주입**

초기에 호출자(인터셉터·필터·스케줄러) 가 `traceId: getTraceId()` 를 명시. 운영 로그 분석 중
스케줄러 로그에 traceId 가 누락되는 버그(스케줄러에서 명시를 빠뜨림) 발견 → `LoggerService.append`
가 trace-context ALS 에서 _자동 주입_ 하도록 변경. 호출자 코드는 traceId 를 신경 쓰지 않아도 되며,
모든 로그가 일관되게 traceId 를 보유.

### 본 과제로 새로 보인 것들

**고수준 스케줄링 시스템의 _흡수된 복잡도_**

BullMQ · RabbitMQ · AWS SQS · Lambda · EKS CronJob 등 평소 _그냥 가져다 쓰던_ 스케줄링 ·
큐잉 시스템들이 얼마나 많은 _복잡한 상황을 안에서 흡수_ 해주고 있었는지, 본 과제에서 직접
작은 스케줄러를 만들며 비로소 보였다.

본 과제에서 다룬 tick 중복 방지 · 점유 직렬화 · 부분 실패 격리 · traceId 그룹핑만 해도
_결정 + 코드 + 테스트_ 가 한 묶음씩 따라붙는다. 그리고 본 과제 범위 밖으로 미뤄둔
재시도 · 백오프 · dead-letter · 분산 작업 분배 · fence token · 우선순위 큐 · 지연 실행 같은
항목들은 위 기성품들이 _이미 검증된 형태로 제공_ 한다. "기성품을 쓴다" 가 단순한 편의가 아니라
_수년의 운영 경험이 응축된 신뢰_ 라는 감각이 한 단계 또렷해졌다.

**RDB · Redis 가 제공하는 동시성 제어 도구의 풍요로움**

저장소가 _단일 JSON 파일_ 인 본 과제는 동시성 제어를 application 레이어 mutex 로만 보호해야
했다. 평소 무의식적으로 의존하던 RDB 의 `SELECT FOR UPDATE` · transaction isolation level ·
advisory lock, Redis 의 `SETNX` · Sorted Set 기반 점유 큐 같은 _저장소 자체가 동시성을 제공하는
환경_ 이 얼마나 편리한 발판이었는지 새삼 느꼈다.

그런 도구가 없는 환경에서는 _전부 application 코드에 책임이 떨어지고_, 그 application 코드는
_멀티 프로세스 환경에선 무력하다_. 동시성 제어가 *환경에 의해 얼마나 결정되는지* 에 대한 감각이
분명해졌다.

### 시간이 더 있다면

- **멀티 프로세스 환경 지원** — 외부 락(Redis Redlock) 또는 낙관적 락 도입. 저장소 교체 동반.
- **재시도 정책** — `attempts` 필드 + max retry + 백오프 + dead-letter
- **로그 회전** — 사이즈 기반 회전 + 보존 기간 설정
- **인증 · 인가** — JWT 또는 API Key
- **부하 테스트** — `autocannon` 으로 동시 요청 처리량 측정
- **W3C Trace Context** — `traceparent` 헤더 호환 (OpenTelemetry 통합)
- **`description` null 클리어** — `@ValidateIf` 추가 또는 별도 액션 플래그
- **컨트롤러 단위 테스트** — 현재는 e2e 가 책임. 시간 여유 시 응답 wrapping 책임을 단위
  레벨에서도 분리 검증

---

## AI 활용 안내

본 과제는 명세가 명시 허용한 AI 도구 활용 흐름으로 진행되었다 (Claude Code). 모든 결정의 사유는
`docs/` 의 결정 문서에 단일 진실 공급원으로 기록되어있습니다.

진행 보조 자동화:

```
.claude/skills/
├── commit-draft/   git-convention.md 적용 커밋 메시지 초안
└── test-audit/     5 기준 (독립성 · 내구성 · 핵심 · G-W-T · 간결성) 테스트 감사
```

---

## 참고 문서

| 문서                          | 내용                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `docs/requirements.md`        | 도메인 · API · 동시성 · 로깅 · 테스트 · AOP · 명세 해석 — _결정의 단일 진실 공급원_ |
| `docs/coding-style.md`        | JSDoc · 인라인 주석 · 명명 · 제어 흐름 · TypeScript · Lint·Format                   |
| `docs/git-convention.md`      | 브랜치 · 커밋 · PR · merge                                                          |
| `docs/implementation-plan.md` | 20 브랜치 / 5 Phase 로드맵                                                          |
| `docs/local-test-scenario.md` | 평가자용 단계별 검증 체크리스트                                                     |
| `CLAUDE.md`                   | 위 세 문서(requirements · coding-style · git-convention) import 허브                |

---

## 라이선스

본 과제는 채용 평가 목적의 비공개 자료. 외부 공개 · 제3자 공유 금지.
