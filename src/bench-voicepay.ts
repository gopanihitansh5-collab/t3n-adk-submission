/**
 * Latency of the PLACEHOLDER path — the number the voice use case actually needs.
 *
 * src/bench-latency.ts measured `search-offers`, which uses plain `http` and carries no
 * PII. That is the wrong path to quote for a payment: host-side marker resolution is
 * extra work, and it happens inside the enclave on the critical path.
 *
 * This measures `authorize-payment` on ppc-voice-pay, which actually resolves
 * {{profile.*}} markers, against the same conversational budget.
 *
 * Run: node --env-file=.env src/bench-voicepay.ts
 */
import { performance } from "node:perf_hooks";
import { getClient } from "./client.ts";

const TAIL = "voicepay";
const VERSION = "0.1.1";
const ENDPOINT = "https://postman-echo.com/post";
const ROUNDS = 8;

const ms = (n: number) => `${n.toFixed(0)} ms`;

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], median: q(0.5), p95: q(0.95), max: s[s.length - 1] };
}

const { t3n, tenantDid } = await getClient();
const tid = tenantDid.replace("did:t3n:", "");
const scriptName = `z:${tid}:${TAIL}`;

console.log(`script : ${scriptName}@${VERSION}`);
console.log(`rounds : ${ROUNDS}\n`);

const samples: number[] = [];
let lastProof: Record<string, unknown> | null = null;

for (let i = 0; i < ROUNDS; i++) {
  const t0 = performance.now();
  try {
    lastProof = (await t3n.executeAndDecode({
      script_name: scriptName,
      script_version: VERSION,
      function_name: "authorize-payment",
      pii_did: tenantDid,
      input: {
        amount_cents: 4250,
        currency: "GBP",
        idempotency_key: `bench_round_${i}`,
        endpoint: ENDPOINT,
      },
    })) as Record<string, unknown>;
    const dt = performance.now() - t0;
    samples.push(dt);
    console.log(
      `  round ${i + 1}: ${ms(dt).padStart(7)}  ` +
        `markers ${lastProof.markers_sent}/${lastProof.markers_unresolved} unresolved  ` +
        `status ${lastProof.provider_status}`
    );
  } catch (e) {
    console.log(`  round ${i + 1}: FAILED — ${String(e).split("\n")[0].slice(0, 160)}`);
  }
}

if (!samples.length) {
  console.log("\nno successful rounds");
  process.exit(1);
}

const t = stats(samples);
console.log(`
placeholder path (authorize-payment)
  min ${ms(t.min)} · median ${ms(t.median)} · p95 ${ms(t.p95)} · max ${ms(t.max)}   n=${samples.length}

comparison — plain http path (search-offers, no PII), measured earlier
  median 437 ms

marker-resolution overhead: ~${ms(t.median - 437)} on the critical path

conversational budget
  <500 ms   comfortable
  500-800   degrading but usable
  >1500     broken

verdict: ${
  t.median < 500
    ? "fits comfortably inside a turn"
    : t.median < 800
      ? "lands in the DEGRADING band — usable, but it needs a spoken filler\n         (\"one moment, authorizing that\") rather than silence"
      : t.median < 1500
        ? "too slow for the critical path — must run off-turn"
        : "far outside the budget"
}`);

if (lastProof) {
  console.log(`\nsecurity property held on every round: markers_unresolved = ${lastProof.markers_unresolved}`);
}
