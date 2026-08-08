/**
 * Task 6 — Walkthrough: grant agent authorization, then invoke the registered contract.
 * Run: node --env-file=.env src/invoke.ts
 *
 * Self-invocation: agentDid === tenantDid, which the docs endorse as the fast path when
 * you have not provisioned a separate agent identity.
 *
 * NOTE on the payload field names: the server deserialises strictly into
 * `script_name` / `script_version` / `function_name` / `input`. The SDK's own source
 * warns that sending `contract` / `version` / `function` yields
 * "Invalid action request: missing field …" 400s. (Checked: the docs get this right.)
 */
import { getClient } from "./client.ts";

const TAIL = "flight";
const VERSION = "0.4.1";

const { t3n, tenantDid } = await getClient();
const tid = tenantDid.replace("did:t3n:", "");
const scriptName = `z:${tid}:${TAIL}`;

console.log("tenant/agent DID:", tenantDid);
console.log("script name     :", scriptName);

const step = async (label: string, fn: () => Promise<unknown>) => {
  try {
    const out = await fn();
    console.log(`OK   ${label}:`, JSON.stringify(out)?.slice(0, 500));
    return out;
  } catch (e) {
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`FAIL ${label}:`, m.split("\n")[0].slice(0, 400));
    return null;
  }
};

// 1. Authorize: this agent may call these functions on this contract, and may egress
//    only to api.duffel.com. An absent allowed_hosts is read as deny-all egress.
await step("agentAuthUpdate", () =>
  t3n.agentAuthUpdate({
    agents: [
      {
        agentDid: tenantDid,
        scripts: [
          {
            scriptName,
            versionReq: null,
            functions: ["search-offers", "book-offer"],
            allowedHosts: ["api.duffel.com"],
          },
        ],
      },
    ],
    discoverDids: [tenantDid],
  })
);

// 2. Invoke.
await step("search-offers", () =>
  t3n.executeAndDecode({
    script_name: scriptName,
    script_version: VERSION,
    function_name: "search-offers",
    input: {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-09-15",
      cabin_class: "economy",
      adult_count: 1,
    },
  })
);
