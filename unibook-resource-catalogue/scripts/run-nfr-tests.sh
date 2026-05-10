#!/usr/bin/env bash
# scripts/run-nfr-tests.sh
# ─────────────────────────────────────────────────────────────────────────────
# UniBook Resource Catalogue — NFR Test Runner
#
# Runs all NFR tests in order and prints a consolidated pass/fail report.
#
# Usage:
#   chmod +x scripts/run-nfr-tests.sh
#   ./scripts/run-nfr-tests.sh
#
# For load tests against a live server:
#   npm install -D autocannon
#   npm run dev &          # start the server first
#   npx ts-node scripts/nfr-load-test.ts
# ─────────────────────────────────────────────────────────────────────────────

set -e

PASS=0
FAIL=0

LINE="════════════════════════════════════════════════════════════"
echo ""
echo "$LINE"
echo "  UniBook Resource Catalogue — NFR Test Suite"
echo "  Subsystem 2 | Team 13 | Member: Rohitha"
echo "$LINE"
echo ""

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

run_suite() {
  local label="$1"
  local pattern="$2"

  echo -e "${CYAN}${BOLD}▶ $label${NC}"
  if npx jest --testPathPattern="$pattern" --forceExit --detectOpenHandles --verbose 2>&1; then
    echo -e "${GREEN}  ✅ PASSED${NC}\n"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}  ❌ FAILED${NC}\n"
    FAIL=$((FAIL + 1))
  fi
}

# ── Unit tests (existing) ──────────────────────────────────────────────────────
echo -e "${YELLOW}${BOLD}━━━ Unit Tests (existing — must all still pass) ━━━${NC}\n"
run_suite "AvailabilityCacheManager unit tests"     "AvailabilityCacheManager.test"
run_suite "AvailabilityCalendarService unit tests"  "AvailabilityCalendarService.test"
run_suite "ResourceSearchEngine unit tests"         "ResourceSearchEngine.test"

# ── NFR tests ─────────────────────────────────────────────────────────────────
echo -e "${YELLOW}${BOLD}━━━ NFR Tests ━━━${NC}\n"

echo -e "${CYAN}Targets:${NC}"
echo "  NFR-1  P95 cached availability : ≤ 50ms"
echo "  NFR-1  P95 uncached availability: ≤ 350ms"
echo "  NFR-1  P95 search               : ≤ 400ms"
echo "  NFR-2  JWT rejection latency    : ≤ 20ms P95"
echo "  NFR-2  Protected routes         : 6 (100%)"
echo "  NFR-2  DB hits on unauth        : 0"
echo "  NFR-3  Files changed new filter : 0"
echo "  NFR-3  Lines for new filter     : ≤ 15"
echo "  NFR-4  Crash on dep failure     : false"
echo "  NFR-4  Max stale cache          : 30s"
echo "  NFR-5  Cache hit rate           : ≥ 90%"
echo "  NFR-5  Rate limit threshold     : 200 req/15min"
echo ""

run_suite "NFR-1 + NFR-5 Performance & Scalability" "nfr1-nfr5-performance"
run_suite "NFR-2 Security"                           "nfr2-security"
run_suite "NFR-3 Maintainability"                    "nfr3-maintainability"
run_suite "NFR-4 Reliability & Availability"         "nfr4-reliability"

# ── Summary ───────────────────────────────────────────────────────────────────
echo "$LINE"
echo -e "  RESULTS: ${GREEN}$PASS passed${NC}  |  ${RED}$FAIL failed${NC}"
echo "$LINE"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Some NFR tests failed. Review the output above.${NC}"
  echo ""
  echo "Common fixes:"
  echo "  NFR-1/5 latency failures → check if Redis is running (redis-server)"
  echo "  NFR-2 failures           → verify JWT_SECRET matches IAM subsystem"
  echo "  NFR-3 failures           → re-read ResourceSearchEngine.ts"
  echo "  NFR-4 failures           → check AvailabilityCacheManager error handling"
  exit 1
else
  echo -e "${GREEN}All NFR tests passed. ✅${NC}"
  echo ""
  echo "Next step — live load test (requires server + DB + Redis running):"
  echo "  npm run dev &"
  echo "  npm install -D autocannon"
  echo "  npx ts-node scripts/nfr-load-test.ts"
  exit 0
fi
