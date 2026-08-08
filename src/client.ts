/**
 * Shared auth bootstrap for every script in this repo.
 *
 * Tasks 1, 4, 5 and 6 all need the same handshake; keeping it here means there is
 * exactly one auth path to debug rather than four copies of it.
 */
import {
  T3nClient,
  setEnvironment,
  loadWasmComponent,
  eth_get_address,
  metamask_sign,
  createEthAuthInput,
} from "@terminal3/t3n-sdk";

// Docs disagree on this value ("testnet" in the Quickstart, "sandbox" on the product
// page). Verified in SDK v4.30.0: NODE_URLS.sandbox === NODE_URLS.testnet, so they are
// undocumented aliases and "testnet" is already the default. See BUG-001.
setEnvironment("testnet");

export async function getClient() {
  const key = process.env.T3N_API_KEY;
  if (!key) throw new Error("T3N_API_KEY is not set");

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(key);

  // NOT IN THE DOCS — see BUG-011.
  //
  // `trustAnchor` is a REQUIRED field on T3nClientConfig. The Quickstart's published
  // snippet omits it, so the documented code dies inside handshake() with:
  //   TypeError: Cannot read properties of undefined (reading 'unsafe_trust_server')
  //
  // A real anchor needs `expected_peer_ids` + `rtmr3_allowlist` for the cluster. Those
  // values are published NOWHERE — not in the docs, not in the SDK reference, not as an
  // exported constant. So the only way to complete the official Quickstart is the
  // explicit opt-out below, which the SDK's own source calls "the *only* way to skip DKG
  // attestation verification on the handshake path."
  //
  // That means: following the documented happy path REQUIRES disabling the attestation
  // verification this product exists to provide. Never ship this to production.
  const t3n = new T3nClient({
    wasmComponent,
    trustAnchor: { unsafe_trust_server: true },
    handlers: { EthSign: metamask_sign(address, undefined, key) },
  });

  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));

  return { t3n, address, tenantDid: String(did.value ?? did) };
}
