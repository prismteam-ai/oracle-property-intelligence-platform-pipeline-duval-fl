#!/usr/bin/env bash
# Smoke test script for Oracle Pipeline — Duval County
# T069 — Verify deployed frontend, API health, and MCP endpoint.
#
# Usage:
#   FRONTEND_URL=https://... API_URL=https://.../api MCP_URL=https://.../mcp ./scripts/smoke-test.sh
#
# Environment variables:
#   FRONTEND_URL  - Base URL of the deployed frontend (e.g., https://oracle-duval.example.com)
#   API_URL       - Base URL of the API (e.g., https://oracle-duval.example.com/api)
#   MCP_URL       - URL of the MCP endpoint (e.g., https://oracle-duval.example.com/mcp)
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
API_URL="${API_URL:-http://localhost:9080/api}"
MCP_URL="${MCP_URL:-http://localhost:9080/mcp}"

PASS=0
FAIL=0
TOTAL=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

check() {
  local name="$1"
  local result="$2"
  TOTAL=$((TOTAL + 1))

  if [ "$result" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC}  $name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC}  $name"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

echo ""
echo "Oracle Pipeline — Duval County — Smoke Test"
echo "============================================"
echo ""
echo "Frontend: ${FRONTEND_URL}"
echo "API:      ${API_URL}"
echo "MCP:      ${MCP_URL}"
echo ""

# Check 1: Frontend returns 200
echo "--- Frontend ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${FRONTEND_URL}/" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  check "Frontend responds 200" 0
else
  check "Frontend responds 200 (got ${HTTP_CODE})" 1
fi

# Check 2: API health returns 200
echo ""
echo "--- API ---"
HEALTH_RESPONSE=$(curl -s --max-time 10 "${API_URL}/health" 2>/dev/null || echo '{"error":"unreachable"}')
HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/health" 2>/dev/null || echo "000")

if [ "$HEALTH_CODE" = "200" ]; then
  check "API /health responds 200" 0
else
  check "API /health responds 200 (got ${HEALTH_CODE})" 1
fi

# Check if health response contains record count
if echo "$HEALTH_RESPONSE" | grep -q "record_count\|recordCount\|total_properties\|status"; then
  check "API /health returns status data" 0
else
  check "API /health returns status data" 1
fi

# Check 3: MCP endpoint responds
echo ""
echo "--- MCP ---"
MCP_RESPONSE=$(curl -s --max-time 10 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  "${MCP_URL}" 2>/dev/null || echo '{"error":"unreachable"}')

MCP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' \
  "${MCP_URL}" 2>/dev/null || echo "000")

if [ "$MCP_CODE" = "200" ] || [ "$MCP_CODE" = "201" ]; then
  check "MCP endpoint responds" 0
else
  check "MCP endpoint responds (got ${MCP_CODE})" 1
fi

# Check if MCP response is valid JSON
if echo "$MCP_RESPONSE" | python3 -m json.tool >/dev/null 2>&1; then
  check "MCP returns valid JSON" 0
else
  check "MCP returns valid JSON" 1
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "============================================"
echo -e "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC} (${TOTAL} total)"
echo "============================================"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Smoke test FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}Smoke test PASSED${NC}"
  exit 0
fi
