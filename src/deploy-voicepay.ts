/**
 * End-to-end deployment of ppc-voice-pay.
 *
 * Every step prints what it did so the run log is the deployment record.
 * Run: node --env-file=.env src/deploy-voicepay.ts
 */
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { TenantClient, NODE_URLS } from "@terminal3/t3n-sdk";
import { getClient } from "./client.ts";

const WASM = "contract-voice-pay/target/wasm32-wasip2/release/ppc_voice_pay.wasm";
const TAIL = "voicepay";
const VERSION = "0.1.1";
const ENDPOINT = "https://postman-echo.com/post";
const EGRESS_HOST = "postman-echo.com";

const line = (s = "") => console.log(s);
const step = async (label: string, fn: () => Promise<unknown>) => {
  const t0 = performance.now();
  try {
    const out = await fn();
    const ms = (performance.now() - t0).toFixed(0);
    line(`  OK   ${label}  (${ms} ms)`);
    if (out !== undefined && out !== null) {
      line(`       ${JSON.stringify(out).slice(0, 600)}`);
    }
    return out;
  } catch (e) {
    const ms = (performance.now() - t0).toFixed(0);
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    line(`  FAIL ${label}  (${ms} ms)`);
    line(`       ${m.split("\n")[0].slice(0, 500)}`);
    return null;
  }
};

line("=".repeat(78));
line("ppc-voice-pay — deployment record");
line("=".repeat(78));

const { t3n, tenantDid } = await getClient();
const tid = tenantDid.replace("did:t3n:", "");
const scriptName = `z:${tid}:${TAIL}`;

line(`tenant / agent DID : ${tenantDid}`);
line(`script name        : ${scriptName}`);
line(`version            : ${VERSION}`);
line(`egress host        : ${EGRESS_HOST}`);
line("");

const tenant = new TenantClient({
  environment: "testnet",
  t3n,
  tenantDid,
  baseUrl: NODE_URLS.testnet,
});

// ---------------------------------------------------------------------------
line("[1] Populate the user profile that {{profile.*}} resolves from");
// These are deliberately fake. The point is not the values — it is proving the
// host substitutes them and the contract never sees them.
await step("submitUserInput(profile)", () =>
  t3n.submitUserInput({
    profile: {
      first_name: "Ada",
      last_name: "Lovelace",
      email_address: "ada@example.com",
      phone_number: "+442071234567",
    },
  })
);

// ---------------------------------------------------------------------------
line("");
line("[2] Register the contract");
const wasm = new Uint8Array(await readFile(WASM));
line(`  wasm bytes: ${wasm.byteLength}`);

const reg = (await step(`contracts.register(${TAIL}@${VERSION})`, () =>
  tenant.contracts.register({ tail: TAIL, version: VERSION, wasm })
)) as { name: string; contract_id: number } | null;

if (reg) {
  line("");
  line(`  >>> DEPLOYMENT RECORD <<<`);
  line(`      canonical name : ${reg.name}`);
  line(`      contract_id    : ${reg.contract_id}`);
  line(`      wasm bytes     : ${wasm.byteLength}`);
}

// ---------------------------------------------------------------------------
line("");
line("[3] Grant the agent authority — scoped to one function and one host");
await step("agentAuthUpdate", () =>
  t3n.agentAuthUpdate({
    agents: [
      {
        agentDid: tenantDid,
        scripts: [
          {
            scriptName,
            versionReq: null,
            functions: ["authorize-payment"],
            allowedHosts: [EGRESS_HOST],
          },
        ],
      },
    ],
    discoverDids: [tenantDid],
  })
);

// ---------------------------------------------------------------------------
line("");
line("[4] Invoke — the real test");
const payload = {
  script_name: scriptName,
  script_version: VERSION,
  function_name: "authorize-payment",
  pii_did: tenantDid, // binds user context so {{profile.*}} has a profile to read
  input: {
    amount_cents: 4250,
    currency: "GBP",
    idempotency_key: "call_01H_turn_7",
    endpoint: ENDPOINT,
  },
};

const t0 = performance.now();
const proof = await step("authorize-payment", () => t3n.executeAndDecode(payload));
const invokeMs = (performance.now() - t0).toFixed(0);

// ---------------------------------------------------------------------------
line("");
line("[5] Verify the security property");
if (proof && typeof proof === "object") {
  const p = proof as Record<string, unknown>;
  const sent = Number(p.markers_sent ?? -1);
  const left = Number(p.markers_unresolved ?? -1);
  line(`  markers emitted by contract : ${sent}`);
  line(`  markers reaching destination: ${left}`);
  line(`  provider status             : ${p.provider_status}`);
  line(`  fields requested            : ${JSON.stringify(p.fields)}`);
  line("");
  if (left === 0 && sent > 0) {
    line(`  PASS — all ${sent} markers were resolved host-side inside the enclave.`);
    line(`         The contract never held a value; the agent never saw one.`);
  } else {
    line(`  FAIL — ${left} of ${sent} markers survived to the destination.`);
  }
  line("");
  line(`  agent-visible summary: ${p.summary}`);
} else {
  line("  no proof returned — see the failure above");
}

line("");
line(`invoke latency (placeholder path): ${invokeMs} ms`);
line("=".repeat(78));
