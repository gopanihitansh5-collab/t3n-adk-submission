# Bug Report — Terminal 3 ADK

**Reporter:** Hitansh Gopani · Pitch Perfekt Collective
**Date:** 2026-08-08 · **SDK:** `@terminal3/t3n-sdk` · **Sample contract:** `z-tenant-flight` @ 0.4.1
**Environment:** Windows 11, Node v24.14.1, Rust 1.97.1, target `wasm32-wasip2`

Bugs below marked **[docs]** were found by reading the documentation and sample repository
before running anything. Bugs marked **[runtime]** were hit during execution. Each entry
gives an exact location and a repro so it can be actioned without a follow-up question.

---

## BUG-001 — Three different names for the same environment · **Low** · [docs]

> **Severity revised down after verification.** Initially filed as High on the assumption
> that `sandbox` and `testnet` were distinct environments. Checking the SDK at runtime
> disproved that: `NODE_URLS.sandbox === NODE_URLS.testnet ===
> "https://cn-api.sg.testnet.t3n.terminal3.io"`, and `testnet` is already the default.
> They are undocumented aliases, so nobody is actually broken. Recorded as a clarity
> defect, not breakage.


**Where:** Quickstart vs. ADK product page vs. `developers/agents/register-agent`

Three surfaces disagree on what the non-production environment is called:

| Source | Value |
|---|---|
| `get-started/quickstart` | `setEnvironment("testnet")` |
| `terminal3.io/products/agent-developer-kit` | `setEnvironment("sandbox")` |
| `developers/agents/register-agent` (CLI) | `--env testnet\|production` — no `sandbox` at all |

**Expected:** One name, used consistently, or an explicit statement that `sandbox` and
`testnet` are aliases.
**Actual:** A developer copying the landing-page snippet into the Quickstart flow has no
way to know which is authoritative.
**Impact:** First-five-minutes failure, on the single most-copied code block you publish.

---

## BUG-002 — Sample contract README and WIT describe **opposite** PII security models · **Critical** · [docs]

**Where:** `Terminal-3/z-tenant-flight` — `README.md` vs `wit/world.wit`

`README.md` states:

> `book-offer` — POST to Duffel `/air/orders` **with full passenger PII**
> "passenger PII (passport number, date-of-birth, full name, email, phone) is **passed in
> by the agent** and used inside the enclave"

`wit/world.wit` states the exact opposite:

> "Carries **NO** passenger PII: the contract templates `{{profile.<field>}}` markers into
> the Duffel order body and the host resolves them from the calling user's profile via
> `http-with-placeholders`."

**Expected:** One security model, described identically in both places.
**Actual:** The README describes PII entering WASM memory — precisely the thing the
product promises never happens. The WIT describes host-side placeholder resolution.
**Impact:** Highest severity in this report. This is the flagship privacy guarantee, and
the reference implementation's own README contradicts it. A developer following the README
would build an agent that ships raw PII into the enclave and believe that is the intended
pattern.

**Which one is right — settled by the code.** Running the crate's own test suite
(`cargo test --lib --target x86_64-pc-windows-gnu`) shows:

```
test booking::tests::book_offer_rejects_inline_pii_fields ... ok
test result: ok. 7 passed; 0 failed
```

The contract **rejects** inline PII. The WIT is correct and **the README is wrong** — it
documents a security model the implementation deliberately refuses to support. Fix the
README, not the code.

---

## BUG-003 — Registering a new version silently re-routes pinned older versions · **High** · [docs]

**Where:** `get-started/walkthrough/register-contract`

The page warns that registering a new version under an existing tail can cause previously
**pinned** versions to route to latest instead.

**Expected:** A pinned version is pinned. That is the entire meaning of pinning.
**Actual:** Documented as a caveat rather than treated as a defect.
**Impact:** Silent behavioural change in production with no error surfaced. The docs'
own mitigation — "keep your own record of every `contract_id`" — is a workaround for
missing platform behaviour.

---

## BUG-004 — Docs state the wrong CLI default and omit a supported environment · **Low** · [docs]

> **Corrected after verification.** Originally filed as "CLI defaults to production, which
> is dangerous with a test key." Running the CLI disproved that — the real default is
> `testnet`. The defect is the reverse: **the documentation is wrong about its own tool.**

**Where:** `developers/agents/register-agent` states:

> "All network commands accept `--env testnet|production` (default **production**)"

**Actual** — `t3n --help` from the shipped CLI (SDK v4.30.0):

```
Global: --env testnet|sandbox|production  --json  --api-key <hex>  --help  --version
Env:    T3N_API_KEY (signing key)  T3N_ENV (default testnet)
```

Two discrepancies:
1. The documented default (`production`) is wrong; the CLI defaults to `testnet`.
2. The documented env list omits `sandbox`, which the CLI accepts.

**Impact:** Low in consequence — the real default is the safe one — but a developer who
trusts the docs will add `--env testnet` believing it is required to avoid spending
against production, and will mis-model where their writes land.

---

## BUG-005 — Sample README's capability manifest omits a capability the contract imports · **High** · [docs]

**Where:** `z-tenant-flight/README.md` vs `wit/world.wit`

README instructs:

```json
{ "host_capabilities": ["kv_store", "logging", "tenant_context", "http"] }
```

But `world.wit` imports `host:interfaces/http-with-placeholders@2.1.0` and its own comment
says that import "requires the `HttpWithPlaceholders` HostCapability, granted at admit time."

**Expected:** The manifest lists every capability the world imports.
**Actual:** `http_with_placeholders` is missing, so `book-offer` — the PII-safe path, i.e.
the whole point of the sample — cannot dispatch under the documented manifest.

---

## BUG-006 — `.cargo/config.toml` pins a wasm target, breaking the documented test command · **Medium** · [docs]

**Where:** `z-tenant-flight/.cargo/config.toml` vs `walkthrough/test` and the sample README

`.cargo/config.toml` contains:

```toml
[build]
target = "wasm32-wasip2"
```

Both the testing page and the README instruct `cargo test` / `cargo test --lib` for
**native** unit tests. With the target pinned globally, cargo builds tests for
`wasm32-wasip2` and cannot execute them natively.

**Expected:** `cargo test --lib` runs native tests as documented.

**Actual — CONFIRMED at runtime:**

```
     Running unittests src\lib.rs (target\wasm32-wasip2\debug\deps\z_tenant_flight-*.wasm)
error: test failed, to rerun pass `--lib`
Caused by:
  could not execute process `...\z_tenant_flight-*.wasm` (never executed)
Caused by:
  %1 is not a valid Win32 application. (os error 193)
```

Cargo compiles the test harness to `wasm32-wasip2`, then tries to execute the `.wasm` as
a native binary.

**Workaround — verified:** `cargo test --lib --target x86_64-pc-windows-gnu`
→ `7 passed; 0 failed`.

**Fix:** either drop `[build] target` from `.cargo/config.toml`, or document the explicit
`--target` on the testing page.

---

## BUG-007 — Version drift across three files in the sample repo · **Low** · [docs]

**Where:** `z-tenant-flight`

| File | Version |
|---|---|
| `README.md` | `v0.3.0` |
| `Cargo.toml` | `0.4.1` |
| `wit/world.wit` | `package z:tenant-flight@0.4.0` |

Registration requires an explicit `version` string, so a developer must guess which of the
three is correct.

---

## BUG-008 — "No Rust or WASM knowledge required" is contradicted by the next page · **Low** · [docs]

**Where:** `get-started/prerequisites` vs `get-started/walkthrough/*`

Prerequisites claim no Rust, WASM, or blockchain knowledge is needed. The walkthrough
immediately requires `rustup target add wasm32-wasip2`, WIT worlds, `wit-bindgen`, and
component-model concepts.

**Impact:** Sets the wrong expectation and mis-scopes setup time.

---

## BUG-009 — API key is unrecoverable with no documented rotation path · **Medium** · [docs]

**Where:** Claim page and `prerequisites/request-test-tokens`

The key displays once and cannot be retrieved afterward. No rotation, revocation, or
re-issue procedure is documented.

**Expected:** A documented path to rotate a leaked key.
**Actual:** A leaked or lost key appears to mean abandoning the DID and its credits.
**Impact:** For a product whose value proposition is verifiable identity and key custody,
this is a conspicuous gap.

---

## BUG-010 — Walkthrough omits the KV secret-seeding prerequisite needed to invoke · **High** · [docs]

**Where:** `walkthrough/invoke-contract` vs `z-tenant-flight/README.md`

`search-offers` reads `duffel_api_key` from the `z:<tid>:secrets` KV map at runtime. Only
the sample repo's README mentions seeding it; the walkthrough's invoke page never does.

**Expected:** The invoke page lists prerequisites, or registration surfaces the required
KV keys.

**CONFIRMED at runtime — and it is worse than a missing sentence.** Following the
walkthrough exactly, `search-offers` fails with:

```
RpcError: contract error: kv read: kv_store.get on 'z:<tid>:secrets' read denied:
access denied: TenantContract(did:t3n:<tid>/511) cannot read map "z:<tid>:secrets"
```

Getting past this required **three** undocumented steps, discovered only by reading SDK
type declarations:

1. Create the map: `tenant.maps.create({ tail: "secrets", … })`
2. **Set `readers` to the contract's numeric id** — `{ only: [511] }`. The ACL is keyed on
   the `contract_id` from registration, *not* the contract name. This is the real reason
   register-contract tells you to keep every id, and that page never says so.
3. Seed the value: `tenant.maps.entrySet("secrets", "duffel_api_key", …)`

Additionally, `MapCreateInput.readers` is optional, and the SDK's own doc comment calls
omitting it "a footgun": an unspecified `readers` silently defaults to **deny-all**, so the
map is created successfully yet nobody — not even its creator — can read it, with no error.

**Verified absent:** the invoke-contract page contains no text about the secrets map or
contract-id ACLs at all.

**After performing all three steps the contract runs end to end** — reaching the real
Duffel API and returning an authentication error for our placeholder token, which proves
the TEE dispatch, KV read, and egress allowlist all function correctly.

---

## Runtime findings

Reproduced on SDK **v4.30.0** against `https://cn-api.sg.testnet.t3n.terminal3.io`,
Node v24.14.1, Windows 11. Raw transcripts in `RUN-LOG.md`.

---

## BUG-011 — The published Quickstart code does not run: `trustAnchor` is required but undocumented · **Critical** · [runtime]

**Where:** `get-started/quickstart` — the primary copy-paste snippet

**Repro:** Copy the Quickstart snippet verbatim, set `T3N_API_KEY`, run it.

**Actual:**

```
TypeError: Cannot read properties of undefined (reading 'unsafe_trust_server')
    at isUnsafeTrustServer  (index.esm.js:2:1013665)
    at assertNodeTrusted    (index.esm.js:2:1111694)
    at T3nClient.handshake  (index.esm.js:2:1131952)
```

**Cause:** `T3nClientConfig.trustAnchor` is a **required**, non-optional field. The SDK's
own doc comment on it reads:

> "It is a required field precisely so no caller can omit it by accident — bypassing
> verification must be a visible, grep-able choice."

The Quickstart omits it entirely. `handshake()` then dereferences `undefined`.

**Compounding — and this is the more serious half:** a real anchor requires
`expected_peer_ids` and `rtmr3_allowlist` for the cluster. **Those values are published
nowhere** — not in the Quickstart, not in the SDK & API Reference (which never mentions
`trustAnchor` at all), and not as an exported constant in the package.

So the only way to complete the official Quickstart is:

```typescript
trustAnchor: { unsafe_trust_server: true }
```

…which the SDK's own source describes as "the *only* way to skip DKG attestation
verification on the handshake path," deliberately named to be alarming in code review.

**Impact:** Every developer completing your Quickstart must disable the remote-attestation
verification that is the product's central security guarantee — and the docs never tell
them they did it. The failure mode is not that the tutorial errors; it's that the obvious
fix is to turn off the security. **Publish testnet anchor values.**

---

## BUG-012 — `getBalance()` throws inside the SDK's own decrypt path · **High** · [runtime]

**Repro:** `await t3n.getBalance()` on a freshly authenticated session.

**Actual:**

```
DOMException [InvalidCharacterError]: Invalid character
    at atob                        (node:buffer:1329:13)
    at base64ToBytes               (index.esm.js:2:302352)
    at SessionEncryption.decrypt   (index.esm.js:2:1114293)
    at T3nClient.sendEncryptedSessionRpc (index.esm.js:2:1161650)
    at T3nClient.getBalance        (index.esm.js:2:1138994)
```

**Expected:** A `BalanceRow` showing the 20,000 claimed test credits.
**Actual:** The SDK attempts to base64-decode a response body that is not valid base64 —
it is decrypting something that was never sealed.

---

## BUG-013 — `getUsage()` fails server-side: SDK sends a sealed blob where the node expects a struct · **High** · [runtime]

**Repro:** `await t3n.getUsage()` on a freshly authenticated session.

**Actual:**

```
RpcError: invalid token.get-usage params:
  invalid type: string "ywwsQFxVRypw+KKxzwLMAI0g+nCD9OpLa5ATWc+W",
  expected struct GetUsageParams
  [45943ab5-9712-414b-b8df-888e196be1be]
```

**Diagnosis:** The SDK seals `token.get-usage` params to the session key and sends the
base64 ciphertext; the node expects a plaintext `GetUsageParams` struct. **SDK and node
disagree on the wire format for this RPC.** BUG-012 is the mirror image on the response
side.

**Isolation:** `listContracts()` on the *same* session succeeds and returns the core
registry (`tee:user@2.20.1`, `tee:vc@2.5.0`, `tee:agent-registry@1.1.23`, …). The session,
handshake, and auth are therefore healthy — the fault is confined to the
sealed-session-payload RPCs.

**It is not just the SDK — the first-party CLI fails identically.** Same key, same node:

```
$ t3n token balance --env testnet
error: RPC Error: invalid token.get-usage params:
  invalid type: string "idL3YtxeewONWtF6pDGVNg+jakCZH876hN1XLhLnVwDHWNt8iCDc",
  expected struct GetUsageParams [ebeb64c3-3e3a-4fb1-ac10-696eee31c5cd]

$ t3n token usage --limit 3 --env testnet
error: RPC Error: invalid token.get-usage params:
  invalid type: string "2aJVUlCOGb6dHjgmc0zKvrNmc6c0x4hBkL1ONb7qGYciZV+9dXsl",
  expected struct GetUsageParams [5eb095d2-fcf2-4f15-97e1-ea55858adf9d]
```

Meanwhile `t3n whoami --env testnet` succeeds and returns the DID, so auth is fine.

**Impact — highest practical severity in this report.** **Four** published surfaces reach
the credit balance and **all four are broken** by one root cause:

| Surface | Result |
|---|---|
| SDK `getBalance()` | ✗ `InvalidCharacterError` in client-side decrypt |
| SDK `getUsage()` | ✗ `invalid token.get-usage params` (node) |
| CLI `t3n token balance` | ✗ same node error |
| CLI `t3n token usage` | ✗ same node error |

There is therefore **no working way for a developer to confirm they received the 20,000
test credits the entire sandbox offer is built around**. The Quickstart's own closing line
— `console.log(\`Credits available: ${balance.available}\`)` — cannot execute against
testnet on v4.30.0.

**Observed workaround:** `tenant.me()` returns `status` and a `quotas` block, which at
least proves the tenant is `active`. It does not report a credit balance.

---

## BUG-014 — SDK ships a critical CVE chain in its dependency tree · **High** · [runtime]

**Repro:** `npm install @terminal3/t3n-sdk && npm audit`

**Actual:** `4 vulnerabilities (3 moderate, 1 critical)`

```
decompress  *  — Severity: CRITICAL
  Zip Slip: arbitrary file write via archive extraction
  GHSA-mp2f-45pm-3cg9, GHSA-h39j-r5qq-r9mm
└─ @bytecodealliance/weval
   └─ @bytecodealliance/componentize-js
      └─ @bytecodealliance/jco
```

**Impact:** A fresh install of an identity-and-trust SDK reports a critical
arbitrary-file-write advisory. Independent of exploitability, it will fail supply-chain
gates at exactly the regulated enterprises this product targets.

---

## BUG-016 — `tenant.claim()` returns an opaque `Internal error` · **Medium** · [runtime]

**Repro:** `await tenantClient.tenant.claim()` on an already-active testnet tenant.

**Actual:**

```
RpcError: RPC Error: Internal error [033b6a21-66ff-4d47-a2a4-f3f47eeec3ff]
```

**Expected:** Either success, or a specific idempotent response. The SDK defines
`TenantSelfAdmitResult` with `status: "admitted" | "already-admitted"` precisely so that
re-claiming is a first-class, non-error outcome — but the node returns a bare
`Internal error` instead.

`tenant.me()` on the same session succeeds and reports `status: "active"`, so the tenant
*is* admitted. The claim path just cannot say so.

**Impact:** A 500 with no detail on the credit-claiming path, in a product whose headline
offer is "claim 20,000 test credits." A developer cannot distinguish "already claimed"
from "claiming is broken." Related to BUG-012/013 — every credit-facing surface is
currently unusable.

---

## BUG-015 — Shipped SDK is obfuscated, making integration failures near-undebuggable · **Medium** · [runtime]

**Where:** `node_modules/@terminal3/t3n-sdk/dist/index.esm.js`

The published bundle is control-flow-obfuscated with mangled identifiers
(`_0x18ca94`, `_0x1e6e`, string-array rotation) on a **single line**. No source maps ship.

**Consequences observed while filing BUG-011/012/013:**

- Every stack frame resolves to `index.esm.js:2:<column>` — useless without the source
- A single thrown error printed **1.2 MB** of minified source into the terminal
- Diagnosing BUG-013 required reading `index.d.ts` type declarations, since the
  implementation is unreadable

**Impact:** For a security product asking enterprises to trust it with identity and key
custody, shipping unauditable obfuscated code is a posture problem as much as a DX one.
