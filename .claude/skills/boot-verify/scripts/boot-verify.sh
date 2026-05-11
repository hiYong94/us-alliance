#!/usr/bin/env bash
# us-alliance NestJS 앱 부팅 + 통합 엔드포인트 검증
# 사이드 이펙트: jobs.json 임시 백업/복원, logs/ 삭제, port 3000 점유 프로세스 종료
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3000}"
BACKUP="/tmp/jobs-skill-backup.json"
LOG="/tmp/nest-bootstrap.log"
NEST_PID=""

cleanup() {
  if [ -n "$NEST_PID" ]; then
    kill "$NEST_PID" 2>/dev/null || true
    wait "$NEST_PID" 2>/dev/null || true
  fi
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" jobs.json
    rm -f "$BACKUP"
  fi
  rm -rf logs
}
trap cleanup EXIT

ok()  { echo "✓ $1"; }
bad() { echo "✗ $1"; }

# 1. port 정리
lsof -ti:"$PORT" | xargs -r kill 2>/dev/null || true
sleep 1

# 2. 샘플 백업, 로그 정리
if [ -f jobs.json ]; then
  cp jobs.json "$BACKUP"
fi
rm -rf logs

# 3. 부팅 — @Timeout(5000) 스케줄러 발화 전에 검증을 끝내기 위해 sleep 3 로 짧게 잡는다
npm start > "$LOG" 2>&1 &
NEST_PID=$!
sleep 3

if ! grep -q "successfully started" "$LOG"; then
  bad "부팅 실패"
  tail -20 "$LOG"
  exit 1
fi
ok "부팅 성공"

# 4. /docs
code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/docs")
if [ "$code" = "200" ]; then
  ok "/docs 200"
else
  bad "/docs $code"
fi

# 5. POST /jobs
response=$(curl -s -i -X POST "http://localhost:$PORT/jobs" \
  -H 'Content-Type: application/json' \
  -d '{"title":"boot-verify-test"}')
status=$(echo "$response" | head -1 | awk '{print $2}')
trace=$(echo "$response" | grep -i "^x-trace-id:" | head -1)
body=$(echo "$response" | awk '/^\r?$/{flag=1; next} flag' | tr -d '\r')
if [ "$status" = "201" ] && [ -n "$trace" ] && echo "$body" | grep -q '"data"'; then
  ok "POST /jobs 201 + envelope + X-Trace-Id"
else
  bad "POST /jobs status=$status trace_header=$([ -n "$trace" ] && echo y || echo n)"
fi

# 6. GET /jobs
body=$(curl -s "http://localhost:$PORT/jobs")
if echo "$body" | grep -q '"data"' && echo "$body" | grep -q '"meta"'; then
  ok "GET /jobs 200 + { data, meta }"
else
  bad "GET /jobs envelope 누락: $body"
fi

# 7. PATCH 미존재
tmp=$(mktemp)
status=$(curl -s -o "$tmp" -w "%{http_code}" -X PATCH \
  "http://localhost:$PORT/jobs/missing" \
  -H 'Content-Type: application/json' \
  -d '{"title":"x"}')
code=$(grep -o '"code":"[^"]*"' "$tmp" | head -1 | cut -d'"' -f4)
rm -f "$tmp"
if [ "$status" = "404" ] && [ "$code" = "JOB_NOT_FOUND" ]; then
  ok "PATCH 미존재 404 JOB_NOT_FOUND"
else
  bad "PATCH 미존재 status=$status code=$code"
fi

# 8. 로그 파일 검증 — interceptor/filter 가 동기적으로 append 하므로 추가 대기 불요
today=$(date +%Y-%m-%d)
if [ -f "logs/$today.log" ]; then
  count=$(grep -c '"type":"http"' "logs/$today.log" || echo 0)
  ok "logs/$today.log 에 http 항목 ${count}건"
else
  bad "logs/$today.log 없음"
fi

echo "---"
echo "검증 종료"
