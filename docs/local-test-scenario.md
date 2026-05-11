# 로컬 테스트 시나리오

본 문서는 `us-alliance` 프로젝트를 로컬에서 단계별로 검증하기 위한 체크리스트다.
각 단계는 *명령* + *기대 결과* 를 함께 제시하여 자가 진단이 가능하다.

평가자 · 신규 컨트리뷰터 · 회귀 검증 시점 모두에서 동일하게 사용 가능.

---

## 0. 사전 준비

> 이하 모든 명령은 **프로젝트 루트** (`package.json` 이 있는 디렉토리) 에서 실행한다.

```bash
# 의존성 (최초 1회)
npm install

# 포트 정리 (이전 실행 잔재 제거)
lsof -ti:3000 | xargs -r kill 2>/dev/null

# 샘플 데이터 · 로그 초기화
git checkout jobs.json
rm -rf logs
```

---

## 1. 자동 게이트

```bash
npm test              # 단위 66 케이스
npm run test:e2e      # e2e 17 케이스
npm run lint          # error 0 (warning 만 허용)
npm run build         # 빌드 그린
```

| 기대 | 실패 시 의미 |
|---|---|
| 4 명령 모두 통과 | 도메인 로직 · API 계약 · 동시성 · 빌드 무결성 보장 |

---

## 2. 수동 탐색 — Swagger UI

```bash
npm run start:dev
```

브라우저: **http://localhost:3000/docs**

| 확인 항목 | 위치 |
|---|---|
| 6 엔드포인트 (`POST/GET /jobs`, `GET /jobs/search`, `GET/PATCH /jobs/:id`, `POST /jobs/:id/run`) | Endpoints |
| 각 DTO 의 `description` · `example` · `minLength` · `maxLength` · `nullable` · `enum` 메타데이터 | Schemas |
| `JobStatus` · `TriggerSource` enum 값 (`PENDING`, `PROCESSING`, ...) | Schemas |
| `ErrorResponse` 모델 | Schemas |
| `Try it out` 직접 호출 동작 | 각 endpoint |

---

## 3. 시나리오 A — 정상 플로우

샘플 데이터 위에서 작업 라이프사이클을 따라간다.

| # | 명령 | 기대 |
|---|---|---|
| A-1 | `curl -X POST localhost:3000/jobs -H 'Content-Type: application/json' -d '{"title":"manual-test","description":"hello"}'` | 201 + `{ data: { id, status: "PENDING", triggeredBy: null, deletedAt: null, ... } }` + 응답 헤더 `x-trace-id` |
| A-2 | `JOB_ID=<위에서 받은 id>` | (변수 저장) |
| A-3 | `curl localhost:3000/jobs/$JOB_ID` | 200 + `{ data: { id, title: "manual-test", ... } }` |
| A-4 | `curl -X PATCH localhost:3000/jobs/$JOB_ID -H 'Content-Type: application/json' -d '{"title":"updated"}'` | 200 + 변경된 title 반영, status 유지 PENDING |
| A-5 | `curl -X POST localhost:3000/jobs/$JOB_ID/run` | 200 + status: PROCESSING, triggeredBy: MANUAL |
| A-6 | `curl localhost:3000/jobs/$JOB_ID` | 200 + status: PROCESSING |
| A-7 | 3~5초 대기 후 `curl localhost:3000/jobs/$JOB_ID` | 200 + status: DONE 또는 FAILED (10% 확률) |

---

## 4. 시나리오 B — 검색 · 페이지네이션

샘플 jobs.json 의 6건 (soft-deleted 1건 포함) 위에서.

| # | 명령 | 기대 |
|---|---|---|
| B-1 | `curl localhost:3000/jobs` | 5건 (soft-deleted 제외), createdAt desc 정렬 |
| B-2 | `curl 'localhost:3000/jobs?limit=2&offset=1'` | 2건 + `meta: { total: 5, limit: 2, offset: 1 }` |
| B-3 | `curl 'localhost:3000/jobs/search?title=백업'` | 1건 (데이터 백업) |
| B-4 | `curl 'localhost:3000/jobs/search?status=DONE,FAILED'` | 2건 (DONE + FAILED) |
| B-5 | `curl 'localhost:3000/jobs/search?title=리포트&status=DONE'` | 1건 (월간 리포트 생성) |
| B-6 | `curl localhost:3000/jobs/55555555-5555-4555-8555-555555555555` (soft-deleted) | 404 + `JOB_NOT_FOUND` |

---

## 5. 시나리오 C — 에러 응답

도메인 에러 코드와 응답 형식 일관성 확인.

| # | 명령 | 기대 응답 |
|---|---|---|
| C-1 | `curl -X POST localhost:3000/jobs -H 'Content-Type: application/json' -d '{}'` | 400 + `VALIDATION_FAILED` + message 에 'title' 언급 |
| C-2 | `curl -X POST localhost:3000/jobs -H 'Content-Type: application/json' -d '{"title":"t","status":"DONE"}'` | 400 + `VALIDATION_FAILED` (whitelist 외 필드) |
| C-3 | `curl -X PATCH localhost:3000/jobs/no-such-id -H 'Content-Type: application/json' -d '{"title":"x"}'` | 404 + `JOB_NOT_FOUND` |
| C-4 | (PROCESSING 상태 id 에 대해) `curl -X PATCH localhost:3000/jobs/$ID -d '{"title":"x"}' -H 'Content-Type: application/json'` | 409 + `JOB_NOT_EDITABLE` |
| C-5 | `curl -X PATCH localhost:3000/jobs/<PENDING id> -d '{}' -H 'Content-Type: application/json'` | 400 + `VALIDATION_FAILED` (≥1 필드 필요) |
| C-6 | cancel 후 재차 PATCH → `curl -X PATCH localhost:3000/jobs/$ID -d '{"title":"x"}' -H 'Content-Type: application/json'` | 409 + `JOB_ALREADY_CANCELED` |

각 에러 응답이 다음 형식을 만족하는지:

```json
{ "statusCode", "code", "message", "timestamp", "path" }
```

---

## 6. 시나리오 D — 동시성 (본 과제 핵심)

### D-1. 동시 PATCH (다른 필드 — 두 변경 모두 보존)

```bash
JOB_ID=$(curl -s -X POST localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title":"concurrent-test"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")

# 두 PATCH 거의 동시 전송
curl -X PATCH localhost:3000/jobs/$JOB_ID -H 'Content-Type: application/json' \
  -d '{"title":"FROM-A"}' &
curl -X PATCH localhost:3000/jobs/$JOB_ID -H 'Content-Type: application/json' \
  -d '{"description":"FROM-B"}' &
wait

# 최종 상태 — 두 변경 모두 반영되어야 함
curl localhost:3000/jobs/$JOB_ID
```

**기대**: title=FROM-A 와 description=FROM-B 가 모두 보존됨 (JobsMutex 직렬화 효과).

### D-2. 동시 수동 실행 (한 쪽만 성공)

```bash
JOB_ID=$(curl -s -X POST localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title":"race-run"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")

(curl -s -o /dev/null -w "1: %{http_code}\n" -X POST localhost:3000/jobs/$JOB_ID/run) &
(curl -s -o /dev/null -w "2: %{http_code}\n" -X POST localhost:3000/jobs/$JOB_ID/run) &
wait
```

**기대**: 한 쪽 200, 다른 쪽 409 (`JOB_ALREADY_CLAIMED`).

---

## 7. 시나리오 E — 스케줄러 관측

```bash
# 깨끗한 상태에서 시작
lsof -ti:3000 | xargs -r kill 2>/dev/null
git checkout jobs.json
rm -rf logs

# 부팅
npm run start:dev
```

다른 터미널에서:

| # | 시점 | 명령 / 관측 | 기대 |
|---|---|---|---|
| E-1 | 부팅 + 5초 | (관측만) | 콘솔에 `Nest application successfully started` 후 5초 뒤 `firstRun → tick` |
| E-2 | tick 직후 | `tail logs/$(date +%Y-%m-%d).log` | `type:scheduler event:tick.start` 와 `tick.end` 가 동일 `tick-<uuid>` traceId 로 그룹핑 |
| E-3 | tick 직후 | `curl 'localhost:3000/jobs/search?status=PROCESSING'` | 점유된 작업 노출 (샘플 PENDING 2건) |
| E-4 | 1~3초 처리 후 | `curl 'localhost:3000/jobs/search?status=DONE'` 와 `status=FAILED` | 처리된 작업이 DONE/FAILED 로 분기 (90:10 비율 기대) |
| E-5 | tick.end 로그 | `grep tick.end logs/$(date +%Y-%m-%d).log` | `processed` · `failed` 카운트 정확 |

---

## 8. 로깅 검증

```bash
ls logs/                                  # 일자별 파일 존재
cat logs/$(date +%Y-%m-%d).log | head -20 | jq .   # JSON Lines 파싱 가능
```

**확인 사항**

- 매 항목이 1 줄 JSON
- `ts`, `level`, `traceId`, `type` 4개 필드가 *모든 항목에 존재*
- HTTP 항목: `method`, `path`, `status`, `durationMs` 포함, `level=info` (성공) 또는 `warn`/`error` (실패)
- Scheduler 항목: `event` (`tick.start`/`tick.end`/`job.done`/`job.failed`/`job.error`), 같은 tick 의 모든 로그가 동일 traceId
- 본문(`title`·`description`) 은 로깅되지 않음 (PII 회피)

---

## 9. 정리

```bash
# 서버 종료 후
git checkout jobs.json   # 샘플 원복
rm -rf logs              # 로그 정리 (gitignore 되어 있어 git status 영향 없음)
```

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| port 3000 already in use | `lsof -ti:3000 \| xargs kill` |
| 부팅 후 즉시 ENOENT (logs/) | `mkdir logs` 후 재시도 (드물게 race) |
| `jobs.json` 이 변경된 채 git status 에 잡힘 | `git checkout jobs.json` 으로 샘플 복원 |
| Swagger UI 가 안 보임 | `/docs` 가 아닌 경로 시도했는지 확인 — `main.ts` 의 `SwaggerModule.setup('docs', ...)` |
| e2e 첫 실행 시 "worker failed to exit gracefully" | jest 첫 컴파일 타이밍 — 재실행 시 사라짐 |

---

## 회귀 게이트 (한 줄 요약)

```bash
npm run lint && npm test && npm run test:e2e && npm run build
```

위 한 줄이 그린이면 도메인·계약·동시성·빌드의 핵심 회귀가 모두 잡혀 있다.
