# 요구사항 정의

본 문서는 어스얼라이언스 백엔드 채용 과제의 요구사항을 분석한 결과,
구현 시 따를 결정 사항을 정리한 명세이다. 코드와 README의 *왜* 에 대한
판단 근거를 한 곳에 모으는 단일 진실 공급원이다.

명세 자체는 [어스얼라이언스 백엔드 엔지니어 채용 과제](../어스얼라이언스%20백엔드%20엔지니어%20채용%20과제%20e4cc74c5eaae8265bd3d81c6b6f3e8a8.md)
파일을 따른다. 본 문서는 그 위에서 *자유 결정 영역*을 어떻게 결정했는지를 다룬다.

---

## 1. 도메인 모델 — Job

### 필드

| 필드 | 타입 | 제약 | 비고 |
|---|---|---|---|
| `id` | uuid v4 | 서버 생성 | `crypto.randomUUID()` |
| `title` | string | 1~120자, 필수 | 사용자 입력 |
| `description` | string | 0~2000자, 선택 | 사용자 입력 |
| `status` | enum | `PENDING` \| `PROCESSING` \| `DONE` \| `FAILED` | 초기값 `PENDING` |
| `triggeredBy` | enum \| null | `SCHEDULER` \| `MANUAL` \| `null` | 처리 시작 시점에 set |
| `createdAt` | ISO 8601 | 서버 생성 | |
| `updatedAt` | ISO 8601 | 변경 시 갱신 | |
| `deletedAt` | ISO 8601 \| null | 취소 시 set | soft delete |

### 상태 전이

```
PENDING ──▶ PROCESSING ──▶ DONE
                       └──▶ FAILED
```

- 단방향. 종료 상태(`DONE`/`FAILED`)에서 이전 상태로 복귀하지 않음
- 별도 `CANCELED` 상태는 두지 않음 — **취소는 `deletedAt` set으로 표현**

### 취소 = soft delete (단일 표현)

- `PENDING` 이고 `deletedAt is null` 인 작업만 취소 가능
- 취소 시 `deletedAt = now()` set, `status` 는 `PENDING` 그대로 둔다
- 스케줄러와 수동 실행 모두 `deletedAt is not null` 인 작업을 처리 대상에서 제외

> **결정 근거**: 명세에 DELETE 엔드포인트가 없어, 취소를 별도 상태로 두면 상태
> 집합과 전이 규칙이 늘어난다. soft delete 의미와 cancel 의미가 사실상 동일하므로
> `deletedAt` 단일 필드로 통합한다.

---

## 2. API

### 2.1 응답 형식

모든 성공 응답은 동일한 형태로 감싼다. 구현은 `src/common/dto/api-response.dto.ts` 의
**추상 베이스 `ApiResponse<T>`** 와 두 구체 클래스 (`SingleResponse<T>`, `PaginatedResponse<T>`)
로 표현한다.

**단건** (`SingleResponse<T>`)

```json
{ "data": { "id": "...", "title": "...", ... } }
```

**목록·검색** (`PaginatedResponse<T>`)

```json
{
  "data": [ { ... } ],
  "meta": { "total": 42, "limit": 20, "offset": 0 }
}
```

> 추상 베이스를 두는 이유: 모든 응답이 `data` 필드를 가진다는 계약을 타입 시스템에 강제하고,
> Swagger 스키마를 `getSchemaPath` + `allOf` 패턴으로 결합 가능하게 한다.

### 2.2 에러 응답 형식

```json
{
  "statusCode": 409,
  "code": "JOB_NOT_EDITABLE",
  "message": "PENDING 상태가 아닌 작업은 수정할 수 없습니다",
  "details": { "currentStatus": "PROCESSING" },
  "timestamp": "2026-05-10T12:00:00.000Z",
  "path": "/jobs/abc-123"
}
```

응답 모델은 `src/common/dto/error-response.dto.ts` 의 `ErrorResponse` 클래스로 정의한다.

| 필드 | 정책 |
|---|---|
| `statusCode` | HTTP 상태 코드와 동일 |
| `code` | 도메인 에러 코드, 대문자 SNAKE_CASE |
| `message` | 한국어, 사용자/개발자 친화 |
| `details` | 디버깅용 부가 정보 (선택) |
| `timestamp` | ISO 8601 |
| `path` | 요청 경로 |

**도메인 에러 코드 (1차)**

- `JOB_NOT_FOUND` (404)
- `JOB_NOT_EDITABLE` (409) — PENDING 아닌 작업의 수정/취소 시도
- `JOB_ALREADY_CANCELED` (409) — 이미 deletedAt set
- `JOB_ALREADY_CLAIMED` (409) — 이미 processing 또는 종료 상태에 진입
- `VALIDATION_FAILED` (400) — class-validator 위반

> **예외 처리 정책**: 발생 가능한 모든 예외는 위 코드 중 하나로 *명시적으로* 처리한다.
> 위 분류에 들어가지 않는 예외가 발생하면 그 자체가 *예상치 못한 결함*이므로 500
> (`Internal Server Error`) 으로 떨어뜨려 새 결함으로 취급하고 신규 도메인 코드를 추가한다.
> "정의되지 않은 상태 전이" 같은 catch-all 코드는 두지 않는다 — 모든 전이는 미리 분류되어야 한다.

도메인 예외는 추상 베이스 `DomainException extends HttpException` 을 상속하며
`readonly code: string` 필드를 갖는다. `AllExceptionsFilter` 는 `instanceof DomainException`
type guard 로 코드를 단일 경로 추출한다.

### 2.3 엔드포인트

| Method | Path | 요청 바디 / 쿼리 | 응답 코드 | 동작 |
|---|---|---|---|---|
| `POST` | `/jobs` | `{ title, description? }` | 201 | 새 작업 생성 |
| `GET` | `/jobs` | `?limit&offset` | 200 | 목록 (FIFO 역순, soft-deleted 제외) |
| `GET` | `/jobs/search` | `?title&status&limit&offset` | 200 | 조건 검색 |
| `GET` | `/jobs/:id` | — | 200 / 404 | 단건 (soft-deleted 404) |
| `PATCH` | `/jobs/:id` | `{ title?, description?, cancel? }` | 200 / 400 / 404 / 409 | 수정 또는 취소 |
| `POST` | `/jobs/:id/run` | — | 200 / 404 / 409 | **수동 실행 트리거** (명세 외 추가) |

### 2.4 엔드포인트 상세

#### POST /jobs

**Request**

```json
{ "title": "Task 1", "description": "Do something" }
```

- `title`: 1~120자, 필수
- `description`: 0~2000자, 선택
- `status` 등 다른 필드는 클라이언트가 보내도 `forbidNonWhitelisted` 로 거부

**Response 201** — 단건 응답.
초기 상태는 `status="PENDING"`, `triggeredBy=null`, `deletedAt=null`.

#### GET /jobs

**Query**

| 파라미터 | 기본값 | 제약 |
|---|---|---|
| `limit` | 20 | 1~100 |
| `offset` | 0 | ≥0 |

- 정렬: `createdAt desc` 고정
- soft-deleted 제외

#### GET /jobs/search

**Query**

| 파라미터 | 동작 |
|---|---|
| `title` | case-insensitive 부분일치. 생략 시 모든 title |
| `status` | 콤마 구분 다중 (`status=PENDING,FAILED`). 생략 시 모든 status |
| `limit` | `GET /jobs` 와 동일 |
| `offset` | `GET /jobs` 와 동일 |

- 정렬: `createdAt desc`
- soft-deleted 제외

> **분리 이유**: `GET /jobs` 와 `GET /jobs/search` 를 분리한 명세 의도를 따른다.
> 단순 페이지네이션 호출자가 검색 파라미터의 무게를 지지 않게 한다.

#### GET /jobs/:id

- soft-deleted 작업은 404로 응답한다 (목록·단건 일관성)

#### PATCH /jobs/:id

**Request** — 모든 필드 optional, **하나 이상 필수**

```json
{ "title": "...", "description": "...", "cancel": true }
```

**규칙**

1. 작업이 PENDING 이 아니면 `409 JOB_NOT_EDITABLE`
2. 이미 `deletedAt is not null` 이면 `409 JOB_ALREADY_CANCELED`
3. `cancel` 은 `true` 만 허용 (false는 의미 없음 — `VALIDATION_FAILED`)
4. `cancel: true` 시 `deletedAt = now()` set, status는 `PENDING` 유지
5. `title`/`description` 수정 시 `updatedAt` 갱신
6. body 가 비었거나 알 수 없는 필드만 있으면 `400 VALIDATION_FAILED`
7. mutex 안에서 검증·수정·write 를 모두 수행
8. `description` 은 *내용 교체만* 지원한다 — `null` 로 명시 전송 시 `VALIDATION_FAILED` 응답.
   기존 값을 비우려는 시도는 별도 정책이 필요하나 본 과제 범위에서는 다루지 않는다 (회고).

**Response 200** — 단건 응답, 수정 후 상태

#### POST /jobs/:id/run (명세 외 추가)

수동 실행 트리거. 다음 스케줄러 tick을 기다리지 않고 즉시 점유한다.

**규칙**

1. PENDING + `deletedAt is null` + 미점유일 때만 허용
2. 위반 시 `409 JOB_ALREADY_CLAIMED` 또는 `JOB_NOT_EDITABLE`
3. 점유은 스케줄러와 **동일한 mutex** (`JobsMutex` provider) 를 통과 → lost update / 동시 점유 방지
4. 점유 시 `triggeredBy = MANUAL` 로 set
5. 처리 자체(sleep + DONE/FAILED)는 비동기로 진행. 응답은 즉시 반환

**Response 200** — `{ data: { ...job, status: "PROCESSING", triggeredBy: "MANUAL" } }`

> 처리 자체는 비동기지만 점유 결과는 동기 응답이므로, 다른 엔드포인트와 일관되게 200 으로 통일한다.

> **명세 외 추가 사유**: 수동·자동 두 트리거 경로의 데이터 무결성을 같은 mutex로
> 검증 가능하게 하여 동시성 평가 포인트를 시연 가능하게 만든다. README에 추가 사유와
> 트레이드오프를 명시한다.

### 2.5 HTTP 상태 코드

| 케이스 | 코드 |
|---|---|
| 생성 성공 | 201 |
| 조회·수정·수동 실행 성공 | 200 |
| 입력 형식 오류 (validation) | 400 |
| 존재하지 않음 | 404 |
| 비즈니스 규칙 위반 (전이/편집/이미 취소·점유) | 409 |
| 서버 내부 오류 (예상 못 한 예외) | 500 |

### 2.6 유효성 검사

- `class-validator` + `class-transformer`
- 전역 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`
- 알 수 없는 필드는 `VALIDATION_FAILED` 로 거부

### 2.7 API 문서화 — Swagger

- `@nestjs/swagger` 도입
- 마운트 경로: `/docs`
- 스키마 소스:
  - DTO 필드: `@ApiProperty` (description, example, required, nullable, type, length 등을 꼼꼼히) + `class-validator` 데코레이터
  - 컨트롤러: `@ApiOperation` (요약·설명) + `@ApiOkResponse`/`@ApiCreatedResponse`/`@ApiBadRequestResponse` 등 상태 코드별 응답
  - 제네릭 wrapper: `@ApiExtraModels(SingleResponse, PaginatedResponse, JobResponse)` 등록 후 `getSchemaPath` + `allOf` 패턴으로 결합
  - enum 값(상태 · 트리거 출처): TypeScript `enum` 정의를 `enumName` 으로 노출
- 컨트롤러 메소드의 외부 계약은 Swagger 데코레이터가 표현하므로 별도 JSDoc 을 두지 않는다
- 평가자가 `npm start` 후 `/docs` 에 접속해 6 개 엔드포인트의 요청 · 응답 · 에러 구조를
  즉시 확인할 수 있도록 한다

### 2.8 환경 변수

`@nestjs/config` 의 `ConfigModule.forRoot({ isGlobal: true })` 를 통해 주입한다.
`process.env` 직접 접근은 금지.

| 키 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `JOBS_DB_PATH` | `jobs.json` | node-json-db 파일 경로 |
| `LOG_DIR` | `logs` | 로그 디렉토리 |

테스트는 `ConfigModule.forRoot({ load: [() => ({ ...overrides })], ignoreEnvFile: true })`
또는 모킹으로 격리한다.

---

## 3. 스케줄러

### 3.1 주기 · 배치

| 항목 | 값 | 비고 |
|---|---|---|
| 주기 | `@Cron('0 * * * * *')` | 매분 0초 |
| 최초 실행 | `@Timeout(5000)` | 부팅 후 5초 — 평가 시연성 ↑ |
| 배치 크기 | `5` | 한 tick 당 점유 최대 수 |
| 점유 정렬 | `createdAt asc` | FIFO |
| 처리 시뮬레이션 | sleep 1~3초 (랜덤) | PROCESSING 상태가 의미 있는 시간 동안 노출 |
| 실패율 | `10%` (`RandomService.next() < 0.1`) | FAILED 상태 시연 |
| 재시도 | 없음 | FAILED 영구 종결 |
| 중복 실행 방지 | `running` boolean flag | 이전 tick 미종료 시 다음 tick skip |

### 3.2 처리 흐름

```
@Cron tick
  ├─ if (running) return
  ├─ running = true
  ├─ try
  │    jobs = service.claimPending(BATCH_SIZE, SCHEDULER)   // JobsMutex 안에서 PENDING → PROCESSING
  │    Promise.allSettled(jobs.map(processOne))             // 병렬 시뮬레이션, 부분 실패 격리
  ├─ finally running = false

processOne(job)
  ├─ sleep(1~3s)  via RandomService
  ├─ if RandomService.next() < 0.1 → service.markFailed(job.id, "simulated failure")
  ├─ else                          → service.markDone(job.id)
```

### 3.3 수동 실행 (POST /jobs/:id/run) 흐름

```
controller
  ├─ service.claimOne(id, MANUAL)   // JobsMutex 안에서 PENDING → PROCESSING + triggeredBy=MANUAL
  ├─ processOne(job) (비동기, await 하지 않음)
  └─ return 200
```

스케줄러 점유과 같은 `processOne` 함수를 공유한다.

---

## 4. 동시성 · 데이터 무결성

### 4.1 위험 시나리오

`node-json-db` 는 read-modify-write 가 atomic 이 아니다. 보호 없이 동시 접근이 발생하면
lost update 가 가능하다.

```
T1 (스케줄러)             T2 (PATCH)
read jobs
                         read jobs
modify (status=PROCESSING)
                         modify (description=...)
write jobs
                         write jobs   ← T1 의 status 변경이 사라짐
```

### 4.2 전략 — Service 레이어 단일 mutex

- 라이브러리: `async-mutex`
- 적용 위치: **`JobsMutex` provider** (단일 인스턴스). Service · Scheduler 가 같은 인스턴스를 주입받음
- Repository 는 **순수 영속성 (CRUD only)** — mutex 보유하지 않음
- 적용 범위:
  - read-only (`findAll`, `findOne`, 검색): **락 없음** — 메모리 캐시에서 가져옴
  - write/RMW (`create`, `update`, `claimPending`, `claimOne`, `markDone`, `markFailed`): mutex 통과

> **Repository 와 mutex 를 분리한 이유**: 영속성과 동시성 정책의 책임을 분리. Repo 는
> 다른 컨텍스트(예: 테스트 fixture 작성, 마이그레이션 스크립트) 에서 락 없이도 재사용 가능.
> Service 가 *언제* 락을 잡는지 코드에 명시적으로 드러난다.

### 4.3 read-modify-write 패턴

모든 PATCH · 스케줄러 점유 · 수동 실행 점유은 `JobsMutex.runExclusive` 안에서
read · 검증 · write 를 완료한다.

```ts
async patch(id: string, dto: PatchJobDto): Promise<Job> {
  return this.mutex.runExclusive(async () => {
    const current = await this.repo.findOne(id);
    if (!current || current.deletedAt !== null) throw new JobNotFoundException(id);
    if (current.status !== JobStatus.PENDING)
      throw new JobNotEditableException(current.status);
    // ... write
    await this.repo.update(id, next);
    return next;
  });
}
```

- `async-mutex` 의 네이티브 API 인 `runExclusive` 를 그대로 사용한다
- 별도 헬퍼(`withLock` 등) 로 한 겹 더 감싸지 않는다 — 추상화 비용 대비 이득이 작고
  *배타 실행* 의 의미를 코드에서 즉시 읽히게 하는 편이 동시성 코드 가독성에 유리
- 데코레이터(`@Exclusive` 등) 로 추상화하지도 않는다 — 락이 잡히는 시점이 코드에서 명시적으로
  드러나야 한다

### 4.4 보장 시나리오

| 시나리오 | 결과 |
|---|---|
| 동시 PATCH (같은 ID 두 건) | 직렬화. 두 번째는 첫 번째 결과 위에서 진행 |
| 스케줄러 점유 ↔ PATCH | 점유 먼저 → PATCH 는 `JOB_NOT_EDITABLE`. PATCH 먼저 → 다음 tick 점유 시 갱신된 상태 위에서 진행 |
| 동시 cancel + 점유 | cancel 먼저 → 점유 후보에서 제외. 점유 먼저 → cancel 은 `JOB_NOT_EDITABLE` |
| 수동 실행 + 스케줄러 동시 점유 | 같은 mutex 통과 → 한 쪽만 성공, 다른 쪽 `JOB_ALREADY_CLAIMED` |
| 1분 안에 tick 미종료 | `running` flag 로 다음 tick skip |
| 멀티 프로세스 환경 | **본 전략 보호 불가** — 외부 락 (Redis Redlock 등) 또는 낙관적 락 필요. README 회고 |

---

## 5. 로깅

### 5.1 위치 · 포맷

- 디렉토리: `logs/` (환경변수 `LOG_DIR` 로 오버라이드)
- 파일: `logs/<YYYY-MM-DD>.log` — **일자별 파티셔닝**
- 포맷: **JSON Lines** (한 줄에 하나의 JSON 객체)
- 매 호출 시 *그 시점의 일자* 로 파일명을 결정 → 자정 경계 자동 처리

### 5.2 로그 항목 (예시)

```jsonc
// HTTP 요청 (성공)
{ "ts": "...", "level": "info", "type": "http", "method": "POST", "path": "/jobs", "status": 201, "durationMs": 12, "traceId": "5f3..." }

// HTTP 에러
{ "ts": "...", "level": "error", "type": "http", "method": "PATCH", "path": "/jobs/abc", "status": 409, "durationMs": 3, "code": "JOB_NOT_EDITABLE", "traceId": "5f3..." }

// 스케줄러 tick
{ "ts": "...", "level": "info", "type": "scheduler", "event": "tick.start", "claimed": 5, "traceId": "tick-..." }
{ "ts": "...", "level": "info", "type": "scheduler", "event": "job.done", "jobId": "...", "durationMs": 1834, "triggeredBy": "SCHEDULER", "traceId": "tick-..." }
{ "ts": "...", "level": "warn", "type": "scheduler", "event": "job.failed", "jobId": "...", "durationMs": 2100, "reason": "simulated failure", "triggeredBy": "SCHEDULER", "traceId": "tick-..." }
{ "ts": "...", "level": "info", "type": "scheduler", "event": "tick.end", "processed": 5, "failed": 1, "traceId": "tick-..." }
```

### 5.3 PII · 보안

- 요청 본문은 로깅하지 않음 (`title`/`description` 는 사용자 입력 — 잠재적 PII)
- 응답 본문도 로깅하지 않음
- 로그 항목은 메타데이터(method, path, status, durationMs, code, jobId 등)에 한정

### 5.4 traceId — 분산 환경 그룹핑

분산 환경 확장 가능성을 전제로 모든 로그 항목에 `traceId` 를 포함한다.

- inbound HTTP: `X-Trace-Id` 헤더 수신 시 그대로 사용, 없으면 `randomUUID()` 생성
- 응답에도 `X-Trace-Id` 헤더 set 하여 클라이언트 추적 가능
- AsyncLocalStorage 로 요청 단위 컨텍스트 전파 — `LoggingInterceptor`, `AllExceptionsFilter`,
  도메인 코드 어디서든 `getTraceId()` 로 접근
- 스케줄러 tick 처럼 클라이언트 컨텍스트가 없는 작업은 tick 진입 시 자체 traceId 를 생성
  (`tick-<uuid>`) 하여 작업 단위 그룹핑

> 본 과제는 단일 프로세스이지만 traceId 를 표준 필드로 두면, 향후 분산 환경 확장 시
> 외부 trace 시스템(W3C Trace Context, OpenTelemetry 등) 과의 통합 비용이 작아진다.

### 5.5 명세 해석

명세는 *"모든 요청은 `logs.txt`에 로깅"* 으로 단일 파일을 명시한다. 본 구현은 *용량 · 가독성
관리* 목적으로 일자 단위 디렉토리 파티셔닝으로 해석한다. README에 해석 명시.

---

## 6. AOP 매핑

NestJS 의 cross-cutting 메커니즘에 비기능 관심사를 위임하여 컨트롤러·서비스의
청결성을 유지한다.

| 관심사 | 메커니즘 | 컴포넌트 |
|---|---|---|
| 요청·응답 로깅 | Interceptor | `LoggingInterceptor` (전역) |
| 에러 응답 + 에러 로깅 | ExceptionFilter | `AllExceptionsFilter` (전역) |
| 입력 유효성 | Pipe | `ValidationPipe` (전역) |
| trace 컨텍스트 | Middleware + AsyncLocalStorage | `TraceContextMiddleware` + `@TraceId()` 데코레이터 |
| 환경 변수 | NestJS 표준 모듈 | `@nestjs/config` `ConfigService` (전역) |
| 응답 형식 | 추상 베이스 + 구체 클래스 | `ApiResponse<T>` / `SingleResponse<T>` / `PaginatedResponse<T>` |
| 에러 응답 모델 | DTO 클래스 | `ErrorResponse` |
| 락 | DI Provider + 라이브러리 네이티브 API | `JobsMutex.runExclusive` (Service 레이어) |
| 무작위성 | DI Provider | `RandomService.next` (스케줄러 시뮬레이션 결정성) |
| 스케줄링 | NestJS 표준 데코레이터 | `@Cron` / `@Timeout` |

> **락은 데코레이터로 추상화하지 않는다**. 동시성 critical section의 *명시성* 이
> 가독성에 결정적이며, 본 과제의 단일 mutex 케이스에서 데코레이터 추상화는 비용 대비
> 이득이 작다.

> **`RandomService` 의 도입 의도**: 도메인의 처리 시뮬레이션이 의도적 무작위 실패를
> 포함하므로, 단위 테스트에서 결정적 결과를 검증하려면 무작위성을 통제할 수 있어야 한다.
> `Math.random` 을 직접 호출하지 않고 의존성 주입 가능한 wrapper 로 분리하여
> "이 코드는 무작위성에 의존한다" 는 사실이 코드에서 드러나게 한다.

---

## 7. 테스트 전략

### 7.1 계층

| 계층 | 도구 | 대상 |
|---|---|---|
| 단위 | Jest | 도메인 로직 (상태 전이, 검색 필터링), `JobsMutex` 직렬화, Repository CRUD, 헬퍼 |
| e2e | `@nestjs/testing` + `supertest` | 6개 엔드포인트 정상·에러 케이스, 응답 구조 일관성 |
| 동시성 | `Promise.all` 부하 시뮬레이션 | 동시 PATCH, 점유 ↔ PATCH, 동시 cancel + 점유, 수동 실행 ↔ 스케줄러 |
| 스케줄러 | 메소드 직접 호출 | `tick()` 직접 호출로 claim · 처리 · marking 흐름 검증. Cron 시간 모킹 회피 |

### 7.2 격리

- 데이터: 각 테스트는 임시 디렉토리에 `jobs.test.json` 생성, `JOBS_DB_PATH` 주입 (ConfigModule override)
- 로그: 동일하게 `LOG_DIR` 주입, 테스트 후 정리
- 결정성: `RandomService` 모킹 (`jest.spyOn(randomService, 'next').mockReturnValueOnce(...)`)

### 7.3 우선순위

3일 제약 안에서 모든 케이스를 다 작성하지 않고, 다음 순서로 우선 작성한다.

1. 단위 — 상태 전이, 검색 필터, mutex 직렬화
2. e2e — 정상 플로우 (POST → GET → PATCH → cancel → run)
3. 동시성 — 핵심 두 시나리오 (PATCH ↔ 스케줄러 점유, 동시 PATCH)
4. 스케줄러 — `tick()` 직접 호출 검증

작성하지 못한 케이스는 README 회고에 기재.

---

## 8. 명세 해석 노트

| 명세 항목 | 본 구현의 해석 | 사유 |
|---|---|---|
| "logs.txt" 단일 파일 | `logs/<date>.log` 일자별 파티셔닝 | 용량 · 가독성 관리 |
| "처리" 의 의미 미정의 | 1~3초 sleep + 10% 시뮬레이션 실패 | 상태 전이 매트릭스(PENDING/PROCESSING/DONE/FAILED) 시연 |
| DELETE 엔드포인트 없음 | PATCH `cancel: true` + soft delete (`deletedAt`) 으로 표현 | 명세 범위 안에서 라이프사이클 종료 표현 |
| 스케줄러 주기 자유 | 매분 0초 | 명세 예시 따름 |
| 한 번에 처리할 단위 자유 | 5건 | 단일 프로세스 부하 분산, 동시성 시연 |
| 수동 실행 경로 미명시 | `POST /jobs/:id/run` 추가 | 수동·자동 트리거 모두 같은 mutex 로 검증 가능하게 함 |

---

## 9. 회고 기재 예정 항목 (README)

3일 제약 안에서 다루지 못한 항목은 README 회고 절에 기재한다.

- 멀티 프로세스 환경에서의 락 (외부 락, 낙관적 락)
- 재시도 정책 (백오프, max attempts, dead-letter)
- 로그 회전 (사이즈 기반, 보존 기간)
- 인증 · 인가
- 성능 부하 테스트 (`autocannon` 등)
- W3C Trace Context (`traceparent` 헤더) 호환 — 현재는 단순 `X-Trace-Id` 만 수용
- `description` 필드의 *null 클리어* 정책 — 현재는 내용 교체만 지원. PATCH 시 `null` 명시는
  거부됨. 별도 액션(`clearDescription: true`) 또는 `@ValidateIf` 로 null 허용하는 안 검토
