---
name: commit-draft
description: |
  현재 staged/unstaged 변경사항을 분석해 docs/git-convention.md 규칙을 적용한 커밋 메시지 초안을 작성한다.

  반드시 다음 상황에서 본 skill 을 호출하라:
  - 사용자가 "커밋 메시지", "커밋 초안", "/commit-draft" 요청
  - 작업이 끝나 git status 에 변경사항이 있는 시점
  - "다음 커밋 어떻게 쓸까", "이 변경 어떻게 커밋" 같은 모호한 표현도 포함

  본 skill 은 사용자 명시 선호 두 가지를 반드시 지킨다:
  1. Co-Authored-By 등 자동 트레일러를 절대 추가하지 않는다
  2. 제목 ≤ 50자 한국어, 마침표 없음, type 접두 필수
---

# commit-draft

## 목적

`docs/git-convention.md` 의 규칙을 자동 적용해 커밋 메시지 초안을 작성한다.
가장 빈번한 실수 — *트레일러 자동 삽입* · *제목 길이 초과* · *type 접두 누락* — 을 사전 차단한다.

## 실행 단계

1. `git status` 와 `git diff --stat` 으로 변경 범위를 파악한다.
2. 변경 성격을 판단해 type 을 결정한다:
   - `feat` — 새 기능
   - `fix` — 버그 수정
   - `refactor` — 동작 변경 없는 코드 개선
   - `chore` — 빌드, 설정, 의존성
   - `docs` — 문서, 주석
   - `test` — 테스트 코드
3. 제목을 ≤ 50자, 한국어, 마침표 없음, `<type>: <제목>` 형식으로 작성한다.
4. 본문은 *왜 변경했는가* 위주로 작성 (선택). 무엇을 변경했는지는 diff 가 말한다.
5. HEREDOC 형식의 `git commit` 명령까지 함께 제시한다.

## 절대 금지

- `Co-Authored-By:` 트레일러 추가 — 사용자 명시 선호 (memory: `feedback_commit_style.md`)
- 자동 생성 트레일러 일체
- 제목 50자 초과
- 제목 끝 마침표 (`.`)
- 영어 제목 (기술 용어 — NestJS, DTO, mutex 등 — 만 영어 허용)

## 출력 포맷

```markdown
**제안 커밋 메시지**

\`\`\`
<type>: <≤50자 한국어 제목>

<선택: 본문 — 왜 변경했는가>
- 항목 1
- 항목 2
\`\`\`

**실행 명령**

\`\`\`bash
git commit -m "$(cat <<'EOF'
<위와 동일 메시지>
EOF
)"
\`\`\`
```

## 참조

- `docs/git-convention.md` — 브랜치 · 커밋 · PR 전체 규칙 (CLAUDE.md 가 자동 import)
- memory: `feedback_commit_style.md` — 트레일러 미사용 강제
