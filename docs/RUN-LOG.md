# Run log — raw terminal output

Verbatim output from the run of 2026-08-08. API key redacted; DIDs and contract ids are
public identifiers and are left intact. Node v24.14.1, Rust 1.97.1, Windows 11,
`@terminal3/t3n-sdk` v4.30.0, node `https://cn-api.sg.testnet.t3n.terminal3.io`.

## 1. Environment

```
$ rustc --version && cargo --version && rustup target list --installed
rustc 1.97.1 (8bab26f4f 2026-07-14)
cargo 1.97.1 (c980f4866 2026-06-30)
wasm32-wasip2
x86_64-pc-windows-gnu

$ node --version && npm --version
v24.14.1
11.11.0
```

## 2. Install — `tsx` cannot install in a OneDrive-synced directory

```
$ npm install @terminal3/t3n-sdk tsx
npm error at validateBinaryVersion (node_modules/esbuild/install.js:103:28)
npm error at node_modules/esbuild/install.js:296:5
npm error   status: 1
```

Root cause is esbuild's postinstall spawning its binary from the synced path. Resolved by
dropping `tsx` entirely — Node 24 strips TypeScript types natively.

```
$ npm install @terminal3/t3n-sdk
added 147 packages, and audited 148 packages in 18s
4 vulnerabilities (3 moderate, 1 critical)
```

## 3. `npm audit` — BUG-014

```
decompress  *
Severity: critical
Decompress: Archive extraction can create files and links outside of the target directory
  - GHSA-mp2f-45pm-3cg9
decompress: Arbitrary File Write via Archive Extraction (Zip Slip)
  - GHSA-h39j-r5qq-r9mm
  @bytecodealliance/weval  →  componentize-js  →  jco
4 vulnerabilities (3 moderate, 1 critical)
```

## 4. Quickstart, first attempt — BUG-011

Running the documented snippet verbatim:

```
key loaded: 66 chars, prefix 0x40
TypeError: Cannot read properties of undefined (reading 'unsafe_trust_server')
    at isUnsafeTrustServer (node_modules/@terminal3/t3n-sdk/dist/index.esm.js:2:1013665)
    at assertNodeTrusted   (node_modules/@terminal3/t3n-sdk/dist/index.esm.js:2:1111694)
    at async T3nClient.handshake (…index.esm.js:2:1131952)
    at async getClient (src/client.ts:33:3)
```

The thrown error printed **1.2 MB** of obfuscated single-line source (BUG-015).

## 5. Quickstart, after adding `trustAnchor` — auth succeeds

```
$ node --env-file=.env src/quickstart.ts
eth address : 0xe85e19061e3e7b38073d9a119ca3c32f45c0066d
connected as: did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed

DOMException [InvalidCharacterError]: Invalid character
    at atob (node:buffer:1329:13)
    at base64ToBytes           (…index.esm.js:2:302352)
    at SessionEncryption.decrypt (…index.esm.js:2:1114293)
    at async T3nClient.getBalance (…index.esm.js:2:1138994)
```

Authentication works; `getBalance()` does not (BUG-012).

## 6. Isolating the balance failure — BUG-013

```
$ node --env-file=.env src/probe-balance.ts
connected as: did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed
FAIL getBalance():    InvalidCharacterError: Invalid character
FAIL getUsage():      RpcError: invalid token.get-usage params: invalid type: string
                      "ywwsQFxVRypw+KKxzwLMAI0g+nCD9OpLa5ATWc+W",
                      expected struct GetUsageParams [45943ab5-9712-414b-b8df-888e196be1be]
OK   listContracts():  {"scope":"core","contracts":[{"name":"tee:user","version":"2.20.1"},
                       {"name":"tee:vc","version":"2.5.0"},
                       {"name":"tee:agent-registry","version":"1.1.23"}, …]}
```

`listContracts()` succeeding on the same session proves handshake, auth and the session
are healthy — the fault is confined to the sealed-payload RPCs.

The first-party CLI fails identically:

```
$ t3n whoami --env testnet
did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed

$ t3n token balance --env testnet
error: RPC Error: invalid token.get-usage params: invalid type: string
  "idL3YtxeewONWtF6pDGVNg+jakCZH876hN1XLhLnVwDHWNt8iCDc",
  expected struct GetUsageParams [ebeb64c3-3e3a-4fb1-ac10-696eee31c5cd]

$ t3n token usage --limit 3 --env testnet
error: RPC Error: invalid token.get-usage params: invalid type: string
  "2aJVUlCOGb6dHjgmc0zKvrNmc6c0x4hBkL1ONb7qGYciZV+9dXsl",
  expected struct GetUsageParams [5eb095d2-fcf2-4f15-97e1-ea55858adf9d]
```

## 7. Build the contract

```
$ cargo build --target wasm32-wasip2 --release
   Compiling wit-bindgen v0.49.0
   Compiling z-tenant-flight v0.4.1
    Finished `release` profile [optimized] target(s) in 34.10s

$ ls -lh target/wasm32-wasip2/release/z_tenant_flight.wasm
-rw-r--r-- 194K z_tenant_flight.wasm
```

## 8. Tests — BUG-006 confirmed

The documented command:

```
$ cargo test --lib
     Running unittests src\lib.rs (target\wasm32-wasip2\debug\deps\z_tenant_flight-….wasm)
error: test failed, to rerun pass `--lib`
Caused by:
  could not execute process `…\z_tenant_flight-….wasm` (never executed)
Caused by:
  %1 is not a valid Win32 application. (os error 193)
```

With an explicit native target:

```
$ cargo test --lib --target x86_64-pc-windows-gnu
running 7 tests
test tests::contract_version_is_v0_4_0 ... ok
test tests::contract_version_is_semver ... ok
test booking::tests::book_offer_bad_input_returns_err ... ok
test search::tests::search_offers_bad_input_returns_err ... ok
test booking::tests::book_offer_non_wasm_returns_err ... ok
test search::tests::search_offers_non_wasm_returns_err ... ok
test booking::tests::book_offer_rejects_inline_pii_fields ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

`book_offer_rejects_inline_pii_fields` passing is the evidence for BUG-002 — the contract
rejects inline PII, so the WIT is correct and the README is wrong.

## 9. Registration

```
$ node --env-file=.env src/register.ts
tenant DID  : did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed
canonical   : z:6ec29eeb5cb122d05e006391d2c954b2390032ed:flight
FAIL tenant.claim(): RpcError: Internal error [033b6a21-66ff-4d47-a2a4-f3f47eeec3ff]
OK   tenant.me(): {"tenant":"did:t3n:6ec29eeb…","label":"testnet-dev","status":"active",
     "quotas":{"max_contracts":10,"max_maps":50,"max_map_keys":10000,
     "max_wasm_bytes":1048576,"fuel_per_call_max":50000000,
     "outbox_calls_per_minute_max":10, …}}
wasm bytes  : 197904
OK   contracts.register(flight@0.4.1):
     {"name":"z:6ec29eeb…32ed:flight","contract_id":511}
OK   contracts.list(): ["z:6ec29eeb…32ed:flight-walkthrough","z:6ec29eeb…32ed:flight"]
```

## 10. Invoke, first attempt — BUG-010

```
$ node --env-file=.env src/invoke.ts
OK   agentAuthUpdate: undefined
FAIL search-offers: RpcError: contract error: kv read:
  kv_store.get on 'z:6ec29eeb…32ed:secrets' read denied: access denied:
  TenantContract(did:t3n:6ec29eeb…32ed/511) cannot read map "z:…:secrets"
  [0b9c9917-37c0-42be-af5d-5bb71d862d8e]
```

## 11. The undocumented step: KV map + contract-id ACL

```
$ node --env-file=.env src/seed-secrets.ts
FAIL maps.create(secrets): RpcError: map already exists [3f0f15fb-…]
OK   maps.entrySet(duffel_api_key): undefined
OK   maps.entryGet(duffel_api_key): "duffel_test_PLACEHOLDER"

$ node --env-file=.env src/fix-acl.ts
OK   maps.update(secrets readers=[511])
```

## 12. Invoke — full TEE round trip ✅

```
$ node --env-file=.env src/invoke.ts
tenant/agent DID: did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed
script name     : z:6ec29eeb5cb122d05e006391d2c954b2390032ed:flight
OK   agentAuthUpdate: undefined
FAIL search-offers: RpcError: contract error: Duffel offer-request failed: HTTP 401 —
  {"errors":[{"documentation_url":"https://duffel.com/docs/api/overview/response-handling",
  "title":"Access token not found","type":"authentication_error",
  "message":"The access token you have used is not a valid API access token",
  "code":"access_token_not_found"}],
  "meta":{"request_id":"GMnF1mMwiWcBR68BZJ2I","status":401}}
```

The 401 originates from Duffel, not Terminal 3. Reaching it required the contract to
dispatch into the enclave, instantiate, resolve host capabilities, read the ACL-gated KV
secret, and perform real outbound HTTPS through the egress allowlist. The walkthrough is
complete; only the third-party credential is a placeholder.
