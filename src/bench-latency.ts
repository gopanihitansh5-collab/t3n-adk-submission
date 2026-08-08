/**
 * How long does a T3N contract invocation actually take?
 *
 * This matters for voice: a conversational turn has a 500-800 ms budget before the
 * interaction degrades, and past ~1.5 s it feels broken. If a TEE contract call sits on
 * the critical path of a phone call, its latency decides whether the design is viable.
 *
 * Measures three things separately so the cost can be attributed:
 *   1. handshake + authenticate  — once per session, amortised
 *   2. a contract call that fails BEFORE egress (bad input)  — TEE dispatch overhead only
 *   3. a contract call that performs real outbound HTTP      — dispatch + egress
 *
 * Run: node --env-file=.env src/bench-latency.ts
 */
import { performance } from "node:perf_hooks";
import { getClient } from "./client.ts";

const TAIL = "flight";
const VERSION = "0.4.1";
const ROUNDS = 5;

const ms = (n: number) => `${n.toFixed(0)} ms`;

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    min: s[0],
    median: p(0.5),
    p95: p(0.95),
    max: s[s.length - 1],
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
  };
}

function report(label: string, xs: number[]) {
  if (!xs.length) return console.log(`${label}: no samples`);
  const t = stats(xs);
  console.log(
    `${label.padEnd(34)} n=${xs.length}  ` +
      `min ${ms(t.min)}  median ${ms(t.median)}  mean ${ms(t.mean)}  max ${ms(t.max)}`
  );
}

// --- 1. session establishment (handshake + auth) -----------------------------
const tSession = performance.now();
const { t3n, tenantDid } = await getClient();
const sessionMs = performance.now() - tSession;

const tid = tenantDid.replace("did:t3n:", "");
const scriptName = `z:${tid}:${TAIL}`;

console.log(`agent DID   : ${tenantDid}`);
console.log(`script      : ${scriptName}`);
console.log(`\nsession establishment (handshake + authenticate): ${ms(sessionMs)}`);
console.log(`  — paid once per session, not per turn\n`);

const call = async (input: unknown) => {
  const t0 = performance.now();
  try {
    await t3n.executeAndDecode({
      script_name: scriptName,
      script_version: VERSION,
      function_name: "search-offers",
      input,
    });
  } catch {
    /* expected — we are timing the round trip, not asserting success */
  }
  return performance.now() - t0;
};

// --- 2. dispatch only: malformed input rejected inside the contract ----------
// The contract validates and returns Err before it ever reaches http, so this
// isolates node round trip + TEE dispatch + WASM instantiation.
const dispatchOnly: number[] = [];
for (let i = 0; i < ROUNDS; i++) dispatchOnly.push(await call({ bad: "input" }));

// --- 3. dispatch + real outbound HTTP to Duffel ------------------------------
const withEgress: number[] = [];
for (let i = 0; i < ROUNDS; i++) {
  withEgress.push(
    await call({
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-09-15",
      cabin_class: "economy",
      adult_count: 1,
    })
  );
}

console.log("per-invocation latency (warm session):\n");
report("dispatch only (no egress)", dispatchOnly);
report("dispatch + outbound HTTP", withEgress);

const dOnly = stats(dispatchOnly).median;
const dEgress = stats(withEgress).median;
console.log(`\negress cost (median delta): ${ms(dEgress - dOnly)}`);

console.log(`
voice-agent budget check
------------------------
conversational turn budget : 500-800 ms before degradation, ~1500 ms before it breaks
T3 dispatch (median)       : ${ms(dOnly)}
T3 dispatch + egress       : ${ms(dEgress)}

verdict: ${
  dEgress < 500
    ? "fits inside a single turn"
    : dEgress < 1500
      ? "too slow for the critical path — must run off-turn with a spoken filler"
      : "far outside the budget — off-turn execution is mandatory"
}`);
