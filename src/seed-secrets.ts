/**
 * The step the Walkthrough never mentions (BUG-010).
 *
 * `search-offers` reads `duffel_api_key` from the KV map `z:<tid>:secrets`. That map must
 * exist AND its read ACL must name the contract's numeric id, or the TEE returns:
 *
 *   access denied: TenantContract(did:t3n:<tid>/511) cannot read map "z:<tid>:secrets"
 *
 * This is why register-contract tells you to keep every contract_id: the id — not the
 * contract name — is what goes in the map ACL.
 *
 * Run: node --env-file=.env src/seed-secrets.ts
 */
import { TenantClient, NODE_URLS } from "@terminal3/t3n-sdk";
import { getClient } from "./client.ts";

const CONTRACT_ID = 511; // from contracts.register — see .paul/STATE.md
const DUFFEL_KEY = process.env.DUFFEL_API_KEY ?? "duffel_test_PLACEHOLDER";

const { t3n, tenantDid } = await getClient();
const tenant = new TenantClient({
  environment: "testnet",
  t3n,
  tenantDid,
  baseUrl: NODE_URLS.testnet,
});

const step = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const out = await fn();
    console.log(`OK   ${label}:`, JSON.stringify(out)?.slice(0, 300));
    return out;
  } catch (e) {
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`FAIL ${label}:`, m.split("\n")[0].slice(0, 350));
    return null;
  }
};

// readers MUST be set explicitly: the SDK notes an omitted `readers` silently defaults to
// deny-all, creating a map nobody — not even its creator — can read, with no error.
await step("maps.create(secrets)", () =>
  tenant.maps.create({
    tail: "secrets",
    visibility: "private",
    writers: { only: [] },
    readers: { only: [CONTRACT_ID] },
  })
);

await step("maps.entrySet(duffel_api_key)", () =>
  tenant.maps.entrySet("secrets", "duffel_api_key", DUFFEL_KEY)
);

await step("maps.entryGet(duffel_api_key)", () =>
  tenant.maps.entryGet("secrets", "duffel_api_key")
);
