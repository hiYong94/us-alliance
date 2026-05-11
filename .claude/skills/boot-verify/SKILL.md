---
name: boot-verify
description: |
  NestJS 애플리케이션을 백그라운드로 부팅 → 핵심 엔드포인트 curl 검증 → 종료·정리 시퀀스를 한 번에 수행한다.

  반드시 다음 상황에서 본 skill 을 호출하라:
  - 새 feat / chore 머지 후 통합 동작 확인 (특히 main.ts · AppModule 변경)
  - DI 누락 · ScheduleModule.forRoot() 누락 같은 wiring 버그 점검
  - 응답 envelope, 에러 envelope, X-Trace-Id 헤더, 일자 파티셔닝 로그 한 번에 검증
  - 사용자 요청 키워드: "부팅 검증", "boot test", "smoke test", "curl probe", "통합 확인", "/boot-verify"

  단위 테스트가 DI 와 @Cron / @Timeout 발화를 잡지 못하므로 wiring 회귀를 catch 하기 위한 1차 게이트로 사용한다.
compatibility:
  tools: [bash]
---

# boot-verify

## 목적

NestJS 앱 부팅 + 6 엔드포인트 통합 동작을 자동 검증한다. 본 과제에서 반복했던 다음 시퀀스를 압축:

1. port 3000 점유 프로세스 종료
2. `jobs.json` 백업 + `logs/` 정리
3. `npm start` 백그라운드 부팅
4. 엔드포인트별 curl probe (응답 코드 · envelope · 헤더 · 로그 항목 검증)
5. 프로세스 종료 + `jobs.json` 복원 + `logs/` 정리

## 실행 단계

```bash
bash .claude/skills/boot-verify/scripts/boot-verify.sh
```

본 스크립트는 직접 실행 가능하며 별도 인자 없이 위 시퀀스를 수행한다.

## 검증 항목

- 부팅 성공 (`Nest application successfully started` 로그)
- `GET /docs` → 200 (Swagger UI 응답)
- `POST /jobs` → 201 + `data` 래퍼 + `X-Trace-Id` 응답 헤더
- `GET /jobs` → 200 + `{ data, meta }` envelope
- `PATCH /jobs/missing` → 404 + `code: JOB_NOT_FOUND` 에러 envelope
- `logs/<오늘>.log` 에 `type: http` 항목 N건 이상 (interceptor + filter 동작 증명)

## 출력 포맷

```
✓ 부팅 성공
✓ /docs 200
✓ POST /jobs 201 + envelope + X-Trace-Id
✓ GET /jobs 200 + { data, meta }
✓ PATCH 미존재 404 JOB_NOT_FOUND
✓ logs/<오늘>.log 에 http 항목 N건
```

실패 시 `✗` 와 함께 사유 1줄. 부팅 자체 실패면 `/tmp/nest-bootstrap.log` 마지막 20줄 함께 표시.

## 사이드 이펙트

- `jobs.json` — 실행 직전 `/tmp/jobs-skill-backup.json` 으로 복사 후, 종료 시 자동 복원 (실패해도 trap 으로 보장)
- `logs/` — 실행 직전·직후 삭제 (`.gitignore` 에 포함되어 추적 영향 없음)
- port 3000 — 기존 점유 프로세스 강제 종료

## 한계

- 본 스크립트는 *부팅 직후 3초 윈도우* 안에 모든 검증을 끝낸다 — 스케줄러 `@Timeout(5000)` 발화 전에 종료하여 `jobs.json` 이 점유 상태로 변하지 않게 한다
- 스케줄러 tick · processOne 동작은 본 skill 범위 밖 — 단위 spec (`jobs.scheduler.spec.ts`) 가 커버
- 본 스크립트가 검증하는 케이스 외 추가 시나리오는 스크립트를 복사 · 수정해 사용
