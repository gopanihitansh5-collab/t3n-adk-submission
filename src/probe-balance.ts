/**
 * Diagnostic for BUG-012: getBalance() throws inside the SDK's session-decrypt path.
 * Tries every documented route to a credit balance and reports which survive.
 * Run: node --env-file=.env src/probe-balance.ts
 */
import { getClient } from "./client.ts";

const { t3n, tenantDid } = await getClient();
console.log("connected as:", tenantDid);

const short = (e: unknown) => {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return m.split("\n")[0].slice(0, 200);
};

for (const [name, call] of [
  ["getBalance()", () => t3n.getBalance()],
  ["getUsage()", () => t3n.getUsage()],
  ["listContracts()", () => t3n.listContracts()],
] as const) {
  try {
    const out = await call();
    console.log(`OK   ${name}:`, JSON.stringify(out).slice(0, 300));
  } catch (e) {
    console.log(`FAIL ${name}:`, short(e));
  }
}
