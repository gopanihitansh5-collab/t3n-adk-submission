# Bug Report — Terminal 3 ADK

**Reporter:** Hitansh Gopani · Pitch Perfekt Collective
**Date:** 2026-08-08 · **SDK:** `@terminal3/t3n-sdk` · **Sample contract:** `z-tenant-flight` @ 0.4.1
**Environment:** Windows 11, Node v24.14.1, Rust 1.97.1, target `wasm32-wasip2`

Bugs below marked **[docs]** were found by reading the documentation and sample repository
before running anything. Bugs marked **[runtime]** were hit during execution. Each entry
gives an exact location and a repro so it can be actioned without a follow-up question.

---

## BUG-001 — Three different names for the same environment · **High** · [docs]

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

## BUG-004 — CLI defaults to `production` while every issued key is a test key · **Medium** · [docs]

**Where:** `developers/agents/register-agent` — "All network commands accept
`--env testnet|production` (default **production**)"

**Repro:** `t3n whoami` (no flag), using a key from the claim page.
**Expected:** Default to the environment the key belongs to, or refuse and require the flag.
**Actual:** Defaults to production. Registration writes consume metered credits, so the
failure mode is silent spend against the wrong network.

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
**Actual:** Expected to fail. *(Verified at runtime — see result appended below.)*
**Workaround:** `cargo test --lib --target x86_64-pc-windows-gnu`

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
**Actual:** Following the walkthrough alone produces a runtime failure inside the TEE,
where it is hardest to diagnose — errors are logged inside the enclave and deliberately
not forwarded to the caller.

---

## Runtime findings

*Appended during execution — see `RUN-LOG.md` for raw transcripts.*

<!-- BUG-011+ go here -->
