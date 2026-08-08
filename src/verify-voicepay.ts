/**
 * Deploy v0.2.0 and run the adversarial checks against the live network.
 *
 * Native tests prove the logic. These prove the *deployed* contract behaves, and
 * one of them settles a defect I could previously only quote from the docs:
 *
 *   BUG-003 claims that registering a new version silently re-routes previously
 *   PINNED versions to latest. v0.1.1 has no marker-injection guard; v0.2.0 does.
 *   So invoking script_version "0.1.1" with an injected marker is a discriminator:
 *     accepted  → 0.1.1 really ran, pinning holds, BUG-003 is wrong
 *     rejected  → 0.2.0 ran under a 0.1.1 pin, BUG-003 is confirmed
 *
 * Run: node --env-file=.env src/verify-voicepay.ts
 */
import { readFile } from "node:fs/promises";
import { TenantClient, NODE_URLS } from "@terminal3/t3n-sdk";
import { getClient } from "./client.ts";

const WASM = "contract-voice-pay/target/wasm32-wasip2/release/ppc_voice_pay.wasm";
const TAIL = "voicepay";
const NEW_VERSION = "0.2.0";
const OLD_VERSION = "0.1.1";
const ENDPOINT = "https://postman-echo.com/post";

const { t3n, tenantDid } = await getClient();
const tid = tenantDid.replace("did:t3n:", "");
const scriptName = `z:${tid}:${TAIL}`;

const tenant = new TenantClient({
  environment: "testnet",
  t3n,
  tenantDid,
  baseUrl: NODE_URLS.testnet,
});

const call = async (version: string, input: Record<string, unknown>) => {
  try {
    const out = await t3n.executeAndDecode({
      script_name: scriptName,
      script_version: version,
      function_name: "authorize-payment",
      pii_did: tenantDid,
      input,
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, err: String(e instanceof Error ? e.message : e).split("\n")[0] };
  }
};

const base = {
  amount_cents: 4250,
  currency: "GBP",
  idempotency_key: "verify_clean",
  endpoint: ENDPOINT,
};

console.log("=".repeat(78));
console.log("ppc-voice-pay v0.2.0 — adversarial verification against the live network");
console.log("=".repeat(78));

// ---------------------------------------------------------------------------
const wasm = new Uint8Array(await readFile(WASM));
const reg = await tenant.contracts.register({ tail: TAIL, version: NEW_VERSION, wasm });
console.log(`\nregistered ${NEW_VERSION} → contract_id ${reg.contract_id} (${wasm.byteLength} bytes)\n`);

// ---------------------------------------------------------------------------
console.log("[A] happy path on 0.2.0");
{
  const r = await call(NEW_VERSION, base);
  const p = r.out as Record<string, unknown> | undefined;
  console.log(
    r.ok
      ? `  PASS  authorized=${p?.authorized} markers ${p?.markers_sent}/${p?.markers_unresolved} status ${p?.provider_status}`
      : `  FAIL  ${r.err}`
  );
}

// ---------------------------------------------------------------------------
console.log("\n[B] marker injection into idempotency_key — must be refused");
{
  const r = await call(NEW_VERSION, { ...base, idempotency_key: "{{profile.first_name}}" });
  console.log(
    !r.ok && r.err?.includes("Marker injection")
      ? `  PASS  refused: ${r.err.slice(0, 120)}`
      : r.ok
        ? `  FAIL  ACCEPTED an injected marker — exfiltration path is open`
        : `  PASS? refused for another reason: ${r.err?.slice(0, 140)}`
  );
}

// ---------------------------------------------------------------------------
console.log("\n[C] inline cardholder data — must be refused");
{
  const r = await call(NEW_VERSION, { ...base, card_number: "4242424242424242" });
  console.log(!r.ok ? `  PASS  refused: ${r.err?.slice(0, 120)}` : `  FAIL  accepted a card number`);
}

// ---------------------------------------------------------------------------
console.log("\n[D] amount over the per-call ceiling — must be refused");
{
  const r = await call(NEW_VERSION, { ...base, amount_cents: 999_999_99 });
  console.log(!r.ok ? `  PASS  refused: ${r.err?.slice(0, 120)}` : `  FAIL  accepted an unbounded amount`);
}

// ---------------------------------------------------------------------------
console.log("\n[E] egress to a host outside the grant — must be refused host-side");
{
  const r = await call(NEW_VERSION, { ...base, endpoint: "https://example.com/post" });
  console.log(
    !r.ok
      ? `  PASS  refused: ${r.err?.slice(0, 140)}`
      : `  FAIL  reached a host that is not on allowedHosts`
  );
}

// ---------------------------------------------------------------------------
console.log("\n[F] BUG-003 discriminator — invoke a PINNED 0.1.1 with an injected marker");
console.log("    0.1.1 has no injection guard; 0.2.0 does. Whichever answers, tells us.");
{
  const r = await call(OLD_VERSION, { ...base, idempotency_key: "{{profile.first_name}}" });
  if (r.ok) {
    console.log(`  → 0.1.1 genuinely executed (no guard, marker accepted).`);
    console.log(`     VERSION PINNING HOLDS. BUG-003 not reproduced on this path.`);
  } else if (r.err?.includes("Marker injection")) {
    console.log(`  → the 0.2.0 guard answered a 0.1.1 pin.`);
    console.log(`     BUG-003 CONFIRMED: a pinned version silently routed to latest.`);
  } else {
    console.log(`  → inconclusive: ${r.err?.slice(0, 200)}`);
  }
}

console.log("\n" + "=".repeat(78));
