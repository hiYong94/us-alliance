# 코딩 스타일

본 문서는 본 과제 코드 작성 시 일관된 표현을 위한 가이드이다.
*과도한 주석을 피하면서도* 의도와 흐름이 드러나도록 하여, 사람과 AI 모두가
코드를 분석하기 용이하게 만드는 것이 목적이다.

---

## 1. 원칙

1. **이름이 1차 문서다** — 변수 · 함수 · 클래스 이름이 의도를 드러내야 한다.
   주석으로 보완해야 하는 이름은 보통 더 나은 이름으로 대체할 수 있다.
2. **주석은 *왜* 만** — 무엇을 하는지는 코드가 말한다. 왜 그렇게 했는지,
   어떤 제약 때문에 이 모양인지를 주석에 남긴다.
3. **JSDoc 은 외부 계약 명세** — public 메소드는 다른 모듈이 의존하는
   인터페이스이므로 계약을 JSDoc 으로 명시한다.
4. **변경 이력은 git 이 가진다** — 작성자 · 이슈 번호 · 변경 날짜를 코드에 남기지 않는다.

---

## 2. JSDoc

### 2.1 작성 대상

| 대상 | 작성 |
|---|---|
| public 메소드 (Service, Repository, Interceptor, Filter, Decorator 공개 API) | **필수** |
| public 클래스 (의도가 이름만으로 자명하지 않은 경우) | 권장 |
| Controller 메소드 | **불요** — `@nestjs/swagger` 의 `@ApiOperation` / `@ApiResponse` 가 외부 계약을 표현 |
| DTO 클래스 / 필드 | **불요** — `class-validator` + `@ApiProperty` 가 제약과 스키마를 표현 |
| enum 멤버 | **권장** — 1줄 JSDoc 으로 도메인 의미 명시 |
| private 메소드 / 헬퍼 | 시그니처로 자명한 경우 생략 |
| 단순 getter / setter | 생략 |

### 2.2 형식

```ts
/**
 * (한 줄 description: 한국어, 동사로 시작, 마침표 없음)
 *
 * (선택: 추가 단락 — 동작 세부, 동시성 보장, 호출 컨텍스트 등)
 *
 * @param name  설명 (필요 시 제약 · 범위)
 * @returns 반환값 설명
 * @throws ExceptionType 던지는 조건
 */
```

### 2.3 예시

**Good — 의도와 동시성 보장이 한눈에 읽힘**

```ts
/**
 * PENDING 상태의 작업을 size 개까지 점유하여 PROCESSING 으로 전환한다
 *
 * 점유은 JobsMutex 안에서 수행되므로 다른 요청 · tick 과의 lost update 가 방지된다
 *
 * @param size 한 번에 점유할 최대 작업 수 (FIFO, createdAt asc)
 * @param triggeredBy 점유 트리거 출처 — 처리 결과 추적에 사용
 * @returns 점유된 작업 목록 (status=PROCESSING, triggeredBy set)
 */
async claimPending(size: number, triggeredBy: TriggerSource): Promise<Job[]>;
```

**Bad — 시그니처 반복, 정보 없음**

```ts
/**
 * size 를 받아서 Job 배열을 반환한다   ← 시그니처에 이미 있음
 * @param size size                    ← 의미 없음
 * @returns Job[]                      ← 의미 없음
 */
async claimPending(size: number): Promise<Job[]>;
```

**Bad — public 메소드인데 미작성**

```ts
async claimPending(size: number): Promise<Job[]>;
```

---

## 3. 인라인 주석

### 3.1 허용 (왜 / 의도 / 제약)

- 동시성 critical section 진입 · 종료의 *이유* 표시
- 비자명한 검증의 *왜*
- 명세 해석에 따른 결정의 *근거*
- 라이브러리 동작의 *주의점* (실수 유발 지점)

```ts
// PATCH 시점에 mutex 를 잡았더라도 read 직후 write 전까지 상태가 바뀔 수 있으므로
// status 검증을 critical section 안에서 다시 수행한다
if (job.status !== JobStatus.PENDING) throw new JobNotEditableException(job.status);
```

```ts
// 명세는 logs.txt 단일 파일을 명시하나, 용량 · 가독성 관리를 위해 일자 파티셔닝으로 해석한다
const file = path.join(this.logDir, `${todayString()}.log`);
```

### 3.2 금지

- 변수명 · 함수명이 이미 표현하는 내용 반복
- "무엇을 하는지" 설명 (코드가 말함)
- 변경 이력 · 이슈 번호 · 작성자 · 작성 날짜
- 주석 처리된 코드 (dead code) — 필요하면 커밋해 두고 최종 PR 전 제거

```ts
// title 을 새 값으로 설정한다       ← bad: 변수명에서 자명
job.title = dto.title;

// 2026-05-10 fix: lost update bug   ← bad: git log 가 가짐
const release = await mutex.acquire();

// const oldImpl = ...;              ← bad: dead code
```

---

## 4. 흐름 주석 (단계 표시)

여러 단계로 구성된 함수는 주요 단계를 번호로 표시할 수 있다. 각 단계가 *무엇* 인지가
코드만으로 즉시 안 읽힐 때만 사용한다.

```ts
async tick(): Promise<void> {
  if (this.running) return;
  this.running = true;
  try {
    // 1. PENDING 작업을 BATCH_SIZE 만큼 점유 (JobsMutex 통과)
    const jobs = await this.service.claimPending(BATCH_SIZE, TriggerSource.SCHEDULER);

    // 2. 병렬로 처리 시뮬레이션 — 부분 실패 격리를 위해 allSettled
    await Promise.allSettled(jobs.map((j) => this.processOne(j)));
  } finally {
    this.running = false;
  }
}
```

> 남용 주의: 한 줄마다 번호 주석을 다는 것은 노이즈. 단계의 경계가 *어디서 어디까지*
> 인지가 코드 블록으로 자명하면 번호 주석을 두지 않는다.

---

## 5. 명명

| 대상 | 패턴 | 예 |
|---|---|---|
| 클래스 | PascalCase | `JobsService`, `LoggingInterceptor` |
| 인터페이스 · 타입 | PascalCase, `I` prefix 미사용 | `Job`, `PatchJobDto` |
| 함수 · 메소드 | camelCase, 동사로 시작 | `claimPending`, `markDone` |
| 상수 | UPPER_SNAKE_CASE | `BATCH_SIZE`, `FAILURE_RATE` |
| **enum 멤버명 · 값** | **UPPER_SNAKE_CASE 통일** | `JobStatus.PENDING = 'PENDING'` |
| 파일 | kebab-case | `jobs.service.ts`, `logging.interceptor.ts` |
| NestJS 컴포넌트 파일 | `<name>.<role>.ts` | `jobs.controller.ts`, `jobs.repository.ts` |
| 테스트 파일 | `<name>.spec.ts` (단위), `<name>.e2e-spec.ts` (e2e) | `jobs.service.spec.ts` |

도메인 예외는 `<Domain><Reason>Exception` 패턴을 따른다.

```
JobNotFoundException
JobNotEditableException
JobAlreadyCanceledException
JobAlreadyClaimedException
```

### 5.1 함수형 콜백 변수명 — 축약 회피

`Array.prototype.{map, filter, find, ...}` 같은 함수형 메소드의 콜백에서 변수명을
무의미하게 축약하지 않는다 — 도메인 의미가 드러나는 명시적 이름을 사용한다.

**Bad — 의미 추론을 강요**

```ts
jobs.find((j) => j.id === id);
items.map((i) => i.value);
list.filter((x) => x.active);
lines.map((l) => JSON.parse(l));
```

**Good — 도메인이 한눈에 읽힘**

```ts
jobs.find((job) => job.id === id);
items.map((item) => item.value);
list.filter((task) => task.active);
lines.map((line) => JSON.parse(line));
```

함수형 체인은 한 줄에 여러 단계가 흐르므로 단축 변수명이 누적되면 추론 비용이
빠르게 누적된다. 변수명이 도메인 어휘를 그대로 드러내면 읽는 사람이 코드와 도메인
문서를 동시에 매핑할 필요가 없다.

**예외** — 외부에서 받는 매개변수의 *원래 타입명이 길어 가독성을 해치는 경우* 만
관용적 축약을 허용한다.

| 축약 | 원래 타입 |
|---|---|
| `req` | `Request` (Express) |
| `res` | `Response` (Express) |
| `ctx` | `ExecutionContext` / `ArgumentsHost` (NestJS) |
| `resolve` / `reject` | `Promise` 의 두 콜백 인자 (이름 자체가 관용) |

이 외의 단일 문자 변수(`j`, `x`, `e`, `v`, `k`, `l` 등) 는 사용하지 않는다.

---

## 6. TypeScript

- `strict: true` 유지 (NestJS 기본값)
- `any` 사용 금지. 외부 라이브러리 타입이 부족한 경우 narrow 타입을 별도로 정의해 사용한다
- DTO · Entity · 내부 타입을 분리한다. 외부 인터페이스(DTO)와 내부 모델(Entity)이 같은
  모양이라도 변경 격리를 위해 별도 타입으로 둔다
- 도메인 enum 값(상태 · 트리거 출처 등) 은 TypeScript `enum` 으로 정의한다
  - **멤버명과 값 모두 UPPER_SNAKE_CASE 로 통일** — 멤버는 상수의 의미, 값은
    API 표면(검색 쿼리 · JSON · 로그) 에 노출되어 시인성 확보
  - 각 멤버에 1 줄 JSDoc 으로 도메인 의미를 명시
    (`/** 처리 대기 — 스케줄러가 점유할 후보 */`)
  - Swagger 스키마 자동 매핑, `@ApiProperty({ enum: ..., enumName: ... })` 와의 정합성에 유리
  - 단일 위치에서 값 추가 · 변경 가능 (string literal 분산 회피)

---

## 7. 제어 흐름

### 7.1 모든 제어 블록은 `{ }` 로 감싼다

`if` / `else` / `for` / `while` 등은 본문이 한 줄이라도 항상 brace 와 줄바꿈을 적용한다.
ESLint `curly: ['error', 'all']` 룰로 강제한다.

**Bad**

```ts
if (typeof res === 'string') return res;
if (!user) throw new UserNotFoundException();
for (const job of jobs) total += job.cost;
```

**Good**

```ts
if (typeof res === 'string') {
  return res;
}
if (!user) {
  throw new UserNotFoundException();
}
for (const job of jobs) {
  total += job.cost;
}
```

이유:
- 본문 추가 시 brace 누락 버그(`if (cond) doA(); doB();` 가 한 줄로 합쳐 보이는 문제) 차단
- diff 가 한 줄에 두 변경(조건 + 본문)을 섞지 않음 → 코드 리뷰 시 의도 명확
- 단일 분기/다중 분기 간 형식 일관성 유지

### 7.2 ternary 표현식은 본 룰의 적용 대상이 아니다

`a ? b : c` 같은 *표현식* ternary 는 위 룰과 별개로 자유롭게 사용 가능.
단, 중첩 ternary(`a ? b : c ? d : e`) 는 가독성을 해치므로 `if/else` 블록으로 풀어 쓴다.

---

## 8. 디렉토리 · 파일 구조

NestJS 표준 모듈 구조를 따른다.

```
src/
├── main.ts
├── app.module.ts
├── config/
│   └── app-config.module.ts          # ConfigModule.forRoot 단일 진입점
├── jobs/
│   ├── jobs.module.ts
│   ├── jobs.controller.ts
│   ├── jobs.service.ts
│   ├── jobs.repository.ts            # 영속성 only (CRUD)
│   ├── jobs.mutex.ts                 # JobsMutex provider
│   ├── jobs.scheduler.ts
│   ├── dto/
│   │   ├── create-job.dto.ts
│   │   ├── patch-job.dto.ts
│   │   ├── list-jobs.query.ts
│   │   ├── search-jobs.query.ts
│   │   └── job.response.ts           # JobResponse — 외부 응답 DTO
│   ├── entities/
│   │   └── job.ts                    # Job 인터페이스 + JobStatus / TriggerSource enum
│   └── exceptions/
│       └── job.exceptions.ts         # DomainException 베이스 + 4종
├── common/
│   ├── dto/
│   │   ├── api-response.dto.ts       # ApiResponse / SingleResponse / PaginatedResponse / PaginationMeta
│   │   └── error-response.dto.ts     # ErrorResponse
│   ├── context/
│   │   └── trace-context.ts          # AsyncLocalStorage + getTraceId
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   ├── filters/
│   │   └── all-exceptions.filter.ts
│   ├── middlewares/
│   │   └── trace-context.middleware.ts
│   ├── decorators/
│   │   └── trace-id.decorator.ts
│   └── random.service.ts             # RandomService — Math.random 추상화
└── logging/
    ├── logging.module.ts
    └── logger.service.ts
```

> 위 구조는 1차안이며 구현 시점에 자연스럽게 조정될 수 있다. 핵심은 *도메인(jobs)* 과
> *cross-cutting(common, logging, config)* 의 분리.

---

## 9. Lint · Format

코드 스타일은 도구로 강제한다 — 가이드 준수 여부를 사람 검토에 맡기지 않는다.

| 도구 | 역할 | 설정 파일 |
|---|---|---|
| Prettier | 포매팅 (들여쓰기, 따옴표, 줄 길이 등) | `.prettierrc` |
| ESLint | 정적 분석 (typescript-eslint recommendedTypeChecked, unused-imports, prettier/recommended) | `eslint.config.mjs` |

**Prettier 설정 요지** — `singleQuote: true`, `semi: true`, `trailingComma: 'all'`,
`printWidth: 100`, `tabWidth: 2`.

**ESLint 설정 요지**
- `typescript-eslint` 의 type-aware 룰 사용 (`recommendedTypeChecked`)
- `eslint-plugin-prettier/recommended` 로 포매팅 위반을 lint error 로 승격
- `eslint-plugin-unused-imports` 로 미사용 import 제거 강제
- `curly: ['error', 'all']` — 모든 제어 블록에 `{ }` 강제 (§7.1)
- `no-unsafe-call` · `no-unsafe-member-access` 는 전역 off (사용자 철학:
  any 타입 허용 + 로직에서 any 회피는 self-discipline)
- 테스트 파일은 일부 unsafe-* 룰 완화 (실용성)

**스크립트**
- `npm run lint` — 자동 수정 + 위반 보고
- `npm run format` — Prettier 적용

CI 도입 시 `npm run lint` 와 `npm run build` 를 통과 게이트로 둔다.

---

## 10. 적용 범위 · 예외

이 가이드는 본 과제 코드 전체에 적용된다. 외부 라이브러리에서 import 한 코드에는
적용되지 않는다. 예외가 필요한 경우 해당 위치에 1 줄 주석으로 *왜 예외인지* 명시한다.
