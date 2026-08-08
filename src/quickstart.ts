/**
 * Task 1 — Quickstart: authenticate to T3N and read the credit balance.
 * Run: node src/quickstart.ts   (Node 24 strips TS types natively; tsx not required)
 */
import { getClient } from "./client.ts";

const { t3n, address, tenantDid } = await getClient();

console.log("eth address :", address);
console.log("connected as:", tenantDid);

const balance = await t3n.getBalance();
console.log("balance     :", JSON.stringify(balance));
