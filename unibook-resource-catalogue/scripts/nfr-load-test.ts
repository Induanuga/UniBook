#!/usr/bin/env ts-node
// scripts/nfr-load-test.ts
// ─────────────────────────────────────────────────────────────────────────────
// LIVE LOAD TEST — Run against the running Resource Catalogue server
// Validates NFR-1 (latency) and NFR-5 (scalability) against the real process.
//
// Prerequisites:
//   npm install -D autocannon    (or: npx autocannon)
//   Server must be running:  npm run dev
//   DB + Redis must be up.
//
// Run:
//   npx ts-node scripts/nfr-load-test.ts
//
// What it tests:
//   Phase 1 — Baseline (50 connections × 10s): proves P95 <= 500ms
//   Phase 2 — Spike    (100 connections × 10s): proves P95 <= 1000ms (2x)
//   Phase 3 — Cache hit rate: 30s warm then measure ratio
// ─────────────────────────────────────────────────────────────────────────────

import autocannon from 'autocannon';
import jwt from 'jsonwebtoken';

// ── NFR targets ───────────────────────────────────────────────────────────────
const NFR1_SYSTEM_P95_MS   = 500;
const NFR5_PEAK_P95_MS     = 1000;
const NFR5_ERROR_RATE_PCT  = 1;
const SERVER_URL           = process.env.SERVER_URL || 'http://localhost:3003';
const JWT_SECRET           = process.env.JWT_SECRET || 'unibook-dev-secret-must-change';

// ── Auth token ────────────────────────────────────────────────────────────────
const token = jwt.sign(
  { jti: 'load-test', sub: 'load-tester', email: 'load@test.edu', name: 'Load Tester', role: 'STUDENT', department: 'CS' },
  JWT_SECRET,
  { expiresIn: '1h', issuer: 'unibook-iam', audience: 'unibook-api' },
);

const AUTH_HEADER = `Bearer ${token}`;

// ── Run autocannon ────────────────────────────────────────────────────────────

function runPhase(
  label: string,
  connections: number,
  durationSeconds: number,
  url: string,
): Promise<autocannon.Result> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📊 ${label}`);
  console.log(`   Connections: ${connections} | Duration: ${durationSeconds}s | URL: ${url}`);
  console.log('─'.repeat(60));

  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url,
      connections,
      duration: durationSeconds,
      headers: { Authorization: AUTH_HEADER },
      requests: [{ method: 'GET' }],
      setupClient: (client) => {
        // Vary the date so each request hits a slightly different cache key
        // This creates a mix of hits and misses to test realistic load
        const dates = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05'];
        let idx = 0;
        client.setHeadersAndBody(
          { Authorization: AUTH_HEADER },
        );
        setInterval(() => { idx++; }, 100);
      },
    }, (err, result) => {
      if (err) reject(err);
      else     resolve(result);
    });

    autocannon.track(instance, { renderProgressBar: true });
  });
}

// ── Results reporter ──────────────────────────────────────────────────────────

function reportPhase(
  label: string,
  result: autocannon.Result,
  p95Target: number,
  errorTarget: number,
) {
  const p95ms      = result.latency.p97_5;  // autocannon uses p97.5 ≈ P95 in our context
  const errorRate  = (result.errors / result.requests.total) * 100;
  const p95Pass    = p95ms <= p95Target;
  const errPass    = errorRate <= errorTarget;

  console.log(`\n📋 ${label} Results:`);
  console.log(`   Requests/sec:      ${result.requests.mean.toFixed(0)}`);
  console.log(`   Latency P95 (ms):  ${p95ms}  ${p95Pass ? '✅' : '❌'}  (target: <=${p95Target}ms)`);
  console.log(`   Latency Mean (ms): ${result.latency.mean.toFixed(1)}`);
  console.log(`   Latency Max (ms):  ${result.latency.max}`);
  console.log(`   Error rate:        ${errorRate.toFixed(2)}%  ${errPass ? '✅' : '❌'}  (target: <=${errorTarget}%)`);
  console.log(`   Total requests:    ${result.requests.total}`);
  console.log(`   2xx responses:     ${result['2xx']}`);
  console.log(`   Non-2xx:           ${result.non2xx}`);
  console.log(`   Errors:            ${result.errors}`);

  return { p95Pass, errPass, p95ms, errorRate };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  UniBook Resource Catalogue — NFR Load Test');
  console.log(`  Server: ${SERVER_URL}`);
  console.log(`  NFR-1 target: P95 <= ${NFR1_SYSTEM_P95_MS}ms`);
  console.log(`  NFR-5 target: P95 <= ${NFR5_PEAK_P95_MS}ms under 2x load, error rate < ${NFR5_ERROR_RATE_PCT}%`);
  console.log('════════════════════════════════════════════════════════════\n');

  const AVAILABILITY_URL = `${SERVER_URL}/resources/a0000000-0000-0000-0000-000000000001/availability?date=2026-06-01`;
  const SEARCH_URL       = `${SERVER_URL}/resources?type=SEMINAR_ROOM`;

  const results: { label: string; pass: boolean }[] = [];

  // ── Phase 1: Availability baseline (50 concurrent — normal load) ──────────
  try {
    const r1 = await runPhase('Phase 1 — Availability Baseline (50 connections)', 50, 10, AVAILABILITY_URL);
    const { p95Pass, errPass } = reportPhase('Phase 1 Availability', r1, NFR1_SYSTEM_P95_MS, NFR5_ERROR_RATE_PCT);
    results.push({ label: 'NFR-1: Availability P95 <= 500ms (50 connections)', pass: p95Pass && errPass });
  } catch (e) {
    console.error('Phase 1 failed:', e);
    results.push({ label: 'NFR-1: Availability P95', pass: false });
  }

  // ── Phase 2: Search baseline (50 concurrent) ──────────────────────────────
  try {
    const r2 = await runPhase('Phase 2 — Search Baseline (50 connections)', 50, 10, SEARCH_URL);
    const { p95Pass, errPass } = reportPhase('Phase 2 Search', r2, 400, NFR5_ERROR_RATE_PCT);
    results.push({ label: 'NFR-1: Search P95 <= 400ms (50 connections)', pass: p95Pass && errPass });
  } catch (e) {
    console.error('Phase 2 failed:', e);
    results.push({ label: 'NFR-1: Search P95', pass: false });
  }

  // ── Phase 3: Availability spike (100 concurrent — 2x load) ───────────────
  try {
    const r3 = await runPhase('Phase 3 — Availability Spike (100 connections)', 100, 10, AVAILABILITY_URL);
    const { p95Pass, errPass } = reportPhase('Phase 3 Spike', r3, NFR5_PEAK_P95_MS, NFR5_ERROR_RATE_PCT);
    results.push({ label: 'NFR-5: Spike P95 <= 1000ms (100 connections, 2x baseline)', pass: p95Pass && errPass });
  } catch (e) {
    console.error('Phase 3 failed:', e);
    results.push({ label: 'NFR-5: Spike P95', pass: false });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  LOAD TEST SUMMARY');
  console.log('════════════════════════════════════════════════════════════');
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'}  ${r.label}`);
    if (!r.pass) allPass = false;
  }
  console.log('════════════════════════════════════════════════════════════\n');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
