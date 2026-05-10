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
 * pending 상태의 작업을 size 개까지 클레임하여 processing 으로 전환한다
 *
 * 클레임은 mutex 안에서 수행되므로 다른 요청 · tick 과의 lost update 가 방지된다
 *
 * @param size 한 번에 클레임할 최대 작업 수 (FIFO, createdAt asc)
 * @param triggeredBy 클레임 트리거 출처 — 처리 결과 추적에 사용
 * @returns 클레임된 작업 목록 (status='processing', triggeredBy set)
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
if (job.status !== 'pending') throw new JobNotEditableException();
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
    // 1. pending 작업을 BATCH_SIZE 만큼 클레임 (mutex 통과)
    const jobs = await this.repo.claimPending(BATCH_SIZE, 'scheduler');

    // 2. 병렬로 처리 시뮬레이션 — sleep + 결과 마킹
    await Promise.all(jobs.map((j) => this.processOne(j)));
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

---

## 6. TypeScript

- `strict: true` 유지 (NestJS 기본값)
- `any` 사용 금지. 외부 라이브러리 타입이 부족한 경우 narrow 타입을 별도로 정의해 사용한다
- DTO · Entity · 내부 타입을 분리한다. 외부 인터페이스(DTO)와 내부 모델(Entity)이 같은
  모양이라도 변경 격리를 위해 별도 타입으로 둔다
- 도메인 enum 값(상태 · 트리거 출처 등) 은 TypeScript `enum` 으로 정의한다
  - Swagger 스키마 자동 매핑, NestJS 데코레이터(`@ApiProperty({ enum: ... })`) 와의 정합성에 유리
  - 단일 위치에서 값 추가 · 변경 가능 (string literal 분산 회피)

---

## 7. 디렉토리 · 파일 구조

NestJS 표준 모듈 구조를 따른다.

```
src/
├── main.ts
├── app.module.ts
├── jobs/
│   ├── jobs.module.ts
│   ├── jobs.controller.ts
│   ├── jobs.service.ts
│   ├── jobs.repository.ts
│   ├── jobs.scheduler.ts
│   ├── dto/
│   │   ├── create-job.dto.ts
│   │   └── patch-job.dto.ts
│   ├── entities/
│   │   └── job.ts
│   └── exceptions/
│       └── job.exceptions.ts
├── common/
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   ├── filters/
│   │   └── all-exceptions.filter.ts
│   ├── middlewares/
│   │   └── request-id.middleware.ts
│   └── decorators/
│       └── request-id.decorator.ts
└── logging/
    ├── logging.module.ts
    └── logger.service.ts
```

> 위 구조는 1차안이며 구현 시점에 자연스럽게 조정될 수 있다. 핵심은 *도메인(jobs)* 과
> *cross-cutting(common, logging)* 의 분리.

---

## 8. 적용 범위 · 예외

이 가이드는 본 과제 코드 전체에 적용된다. 외부 라이브러리에서 import 한 코드에는
적용되지 않는다. 예외가 필요한 경우 해당 위치에 1 줄 주석으로 *왜 예외인지* 명시한다.
