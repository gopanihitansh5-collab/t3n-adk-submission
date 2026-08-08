/**
 * Task 4 — Walkthrough: register the compiled WASM component as a TEE contract.
 * Run: node --env-file=.env src/register.ts
 *
 * Also exercises tenant.claim() / tenant.me(). Because both documented credit-balance
 * routes are broken (BUG-012, BUG-013), `me()`'s quota block is currently the only way
 * observed to see tenant standing.
 */
import { readFile } from "node:fs/promises";
import { TenantClient, NODE_URLS } from "@terminal3/t3n-sdk";
import { getClient } from "./client.ts";

const WASM_PATH = "contract/target/wasm32-wasip2/release/z_tenant_flight.wasm";
const TAIL = "flight";
const VERSION = "0.4.1"; // contract/Cargo.toml — see BUG-007 (README says 0.3.0, WIT says 0.4.0)

const step = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const out = await fn();
    console.log(`OK   ${label}:`, JSON.stringify(out)?.slice(0, 400));
    return out;
  } catch (e) {
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`FAIL ${label}:`, m.split("\n")[0].slice(0, 300));
    return null;
  }
};

const { t3n, tenantDid } = await getClient();
console.log("tenant DID  :", tenantDid);

const tenant = new TenantClient({
  environment: "testnet",
  t3n,
  tenantDid,
  baseUrl: NODE_URLS.testnet,
});

console.log("canonical   :", tenant.canonicalName(TAIL));

await step("tenant.claim()", () => tenant.tenant.claim());
await step("tenant.me()", () => tenant.tenant.me());

const wasm = new Uint8Array(await readFile(WASM_PATH));
console.log("wasm bytes  :", wasm.byteLength);

const res = await step(`contracts.register(${TAIL}@${VERSION})`, () =>
  tenant.contracts.register({ tail: TAIL, version: VERSION, wasm })
);

if (res) console.log("\n>>> RECORD IN STATE.md — contract_id:", JSON.stringify(res));

await step("contracts.list()", () => tenant.contracts.list());
