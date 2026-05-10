# Git 컨벤션

본 문서는 어스얼라이언스 백엔드 채용 과제 진행 중 적용할 Git 컨벤션을 정의한다.
1인 작업이지만 의도가 드러나는 히스토리를 남기기 위해 일관된 규칙을 적용한다.

---

## 브랜치 네이밍

```
<type>/<short-description>
```

| type     | 사용 시점                  |
| -------- | -------------------------- |
| feat     | 새 기능                    |
| fix      | 버그 수정                  |
| refactor | 동작 변경 없는 코드 개선   |
| chore    | 빌드, 설정, 의존성         |
| docs     | 문서, 주석                 |
| test     | 테스트 코드                |

**본 과제 사용 예**

```
chore/nestjs-init
feat/job-crud
feat/job-search
feat/job-scheduler
feat/concurrency-lock
refactor/jobs-repository
test/job-e2e
docs/readme-spec
```

---

## 커밋 메시지

```
<type>: <제목>          ← 50자 이내, 마침표 없음
                        ← 한 줄 공백
<본문>                  ← 선택. 왜 변경했는지 위주
```

- **제목**: 한국어. 기술 용어(NestJS, DTO, mutex, JSON DB, UUID, PATCH 등)는 영어 허용
- **본문**: 생략 가능. 필요 시 *왜 그렇게 결정했는지 / 트레이드오프 / 의도*를 위주로 작성
- **트레일러 미사용**: `Co-Authored-By` 등 자동 생성 트레일러는 추가하지 않는다

**본 과제 사용 예**

```
chore: 어스얼라이언스 백엔드 과제 — NestJS 스캐폴딩
feat: Job 생성/조회 API 추가
feat: GET /jobs/search에 title 부분일치 + status 필터 지원
feat: 스케줄러 1분 주기 pending → processing 전환 처리
feat: node-json-db 동시 접근 보호용 in-process mutex 추가
refactor: JobsService를 Repository 패턴으로 분리
test: Job PATCH 동시성 e2e 테스트 추가
docs: README에 동시성 전략 및 트레이드오프 기술
```

---

## PR

1인 작업이지만 작업 단위 분리와 의사결정 기록을 위해 가능한 한 PR로 진행한다.

**제목**: 커밋 메시지와 동일한 형식 (`<type>: <제목>`)

**본문 템플릿**

```markdown
## 작업 내용
- 변경한 것을 bullet로 간략히

## 의도 / 배경 (선택)
- 왜 이 방식을 선택했는지, 다른 옵션과의 트레이드오프

## 특이사항 (선택)
- 후속 작업, 알려진 한계, 추가 검증이 필요한 부분
```

---

## Merge 전략

- **Merge commit 방식** (GitHub UI에서 수동 merge)
- WIP 커밋(`수정`, `다시`, `wip` 등)은 merge 전 `git rebase -i`로 정리한다
- feature 브랜치의 커밋이 `main`에 그대로 남는 구조

---

## 본 과제에 한정한 추가 규칙

- 모든 작업은 `main`이 아닌 feature 브랜치에서 진행 후 merge한다
  - 단, 본 컨벤션 도입 이전의 초기 스캐폴딩 커밋은 예외 — 회고 시점에 의도가 드러나도록 별도 기재
- 비밀정보(`.env`, 자격 증명 등)는 커밋하지 않는다
- `jobs.json` 샘플 데이터는 커밋 대상이다 (과제 명세 요구사항: *조회 동작 확인용 샘플 데이터 포함*)
- AI 도구 사용은 허용되지만, 모든 커밋의 의사결정을 본인이 설명할 수 있어야 한다 (과제 명세 명시)
