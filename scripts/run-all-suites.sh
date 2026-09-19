#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Every suite, ONE AT A TIME.
#
# ⚠️ NOT `vitest run tests/` AND NOT TWO SHELLS. The suites share one Postgres
# and vitest parallelises files across workers, so running them together
# deadlocks: transactions from two files hold rows the other is waiting on, and
# the uniform 60s timeouts turn contention into a red suite that is green when
# re-run alone. A whole afternoon has been lost to reading that as a bug.
#
# Sequential is slower (~35 min) and is the only way the result means anything.
# ---------------------------------------------------------------------------
set -u
OUT="${1:-/tmp/suites.log}"
: > "$OUT"
STATUS=0

# ⚠️ DISCOVERED, NOT LISTED. The loop used to name the suites, and it drifted:
# it still chased `tests/affiliate`, deleted with the affiliate system, so every
# full run exited 1 on a missing directory. Worse, `tests/ads` and
# `tests/middleware` existed for weeks and were never in the list, so "every
# suite" ran neither. A hardcoded list is a second place to remember, and this
# is what forgetting it looks like.
#
# `money` last on purpose: it is 25 of the 30 minutes, so everything quick fails
# fast. `support` is helpers, not a suite.
SUITES=$(ls -d tests/*/ 2>/dev/null | sed 's|tests/||; s|/||' | grep -v '^support$' | grep -v '^money$' | sort)

for suite in $SUITES money; do
  if [ -z "$(ls tests/"$suite"/*.test.ts 2>/dev/null)" ]; then
    echo "── tests/$suite has no test files, skipped" | tee -a "$OUT"
    continue
  fi
  echo "═══ tests/$suite ═══" | tee -a "$OUT"
  START=$(date +%s)
  npx vitest run "tests/$suite" >> "$OUT" 2>&1
  CODE=$?
  ELAPSED=$(( $(date +%s) - START ))
  if [ $CODE -ne 0 ]; then STATUS=1; fi
  printf '── tests/%s finished: exit %s in %ss\n\n' "$suite" "$CODE" "$ELAPSED" | tee -a "$OUT"
done

echo "═══ SUMMARY ═══" | tee -a "$OUT"
grep -E "Test Files|Tests  " "$OUT" | tee -a "$OUT"
exit $STATUS
