import { TenantClient, NODE_URLS } from "@terminal3/t3n-sdk";
import { getClient } from "./client.ts";
const { t3n, tenantDid } = await getClient();
const tenant = new TenantClient({ environment: "testnet", t3n, tenantDid, baseUrl: NODE_URLS.testnet });
try {
  await tenant.maps.update("secrets", { readers: { only: [511] } });
  console.log("OK   maps.update(secrets readers=[511])");
} catch (e) { console.log("FAIL maps.update:", String(e).split("\n")[0].slice(0,300)); }
