#!/bin/bash

# clifr latency benchmark
CMD="${1:-git push origin fake-branch}"
RUNS=3

echo ""
echo "benchmarking: $CMD"
echo "runs: $RUNS"
echo ""

# ── without clifr ─────────────────────────────────────
echo "── without clifr ──────────────────────────────────"
total_raw=0
for i in $(seq 1 $RUNS); do
  start=$(node -e "process.stdout.write(String(Date.now()))")
  eval "$CMD" 2>/dev/null 1>/dev/null
  end=$(node -e "process.stdout.write(String(Date.now()))")
  ms=$((end - start))
  echo "  run $i: ${ms}ms"
  total_raw=$((total_raw + ms))
done
avg_raw=$((total_raw / RUNS))
echo "  avg: ${avg_raw}ms"
echo ""

# ── with clifr ────────────────────────────────────────
echo "── with clifr (full pipeline) ─────────────────────"
total_clifr=0
for i in $(seq 1 $RUNS); do
  start=$(node -e "process.stdout.write(String(Date.now()))")
  eval "ep $CMD" 2>/dev/null 1>/dev/null
  end=$(node -e "process.stdout.write(String(Date.now()))")
  ms=$((end - start))
  echo "  run $i: ${ms}ms"
  total_clifr=$((total_clifr + ms))
done
avg_clifr=$((total_clifr / RUNS))
echo "  avg: ${avg_clifr}ms"
echo ""

# ── summary ──────────────────────────────────────────
overhead=$((avg_clifr - avg_raw))
echo "── summary ─────────────────────────────────────────"
echo "  raw command:    ${avg_raw}ms"
echo "  with clifr:     ${avg_clifr}ms"
echo "  clifr overhead: ${overhead}ms"
echo ""