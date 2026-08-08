# Deployment record

Everything registered on T3N testnet from this work, with the identifiers needed to
reproduce or audit it. Kept because `register-contract` warns that a new version can
silently re-route pinned versions ([BUG-003](BUGS.md)) — the `contract_id` is the only
durable handle, and it is what the KV read-ACL is keyed on.

**Network** `testnet` · `https://cn-api.sg.testnet.t3n.terminal3.io`
**Tenant / Agent DID** `did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed`
**tid** `6ec29eeb5cb122d05e006391d2c954b2390032ed`
**Derived ETH address** `0xe85e19061e3e7b38073d9a119ca3c32f45c0066d`
**Tenant standing** `label: testnet-dev` · `status: active`

## Contracts

| contract_id | Canonical name | Version | WASM bytes | Source | Status |
|--:|:--|:--|--:|:--|:--|
| **511** | `z:6ec29eeb…32ed:flight` | `0.4.1` | 197,904 | `contract/` — vendored `z-tenant-flight` (MIT) | active · invoked |
| **515** | `z:6ec29eeb…32ed:voicepay` | `0.1.0` | 159,329 | `contract-voice-pay/` — **our own** | superseded |
| **516** | `z:6ec29eeb…32ed:voicepay` | `0.1.1` | 158,806 | `contract-voice-pay/` — **our own** | superseded · used as the BUG-003 control |
| **517** | `z:6ec29eeb…32ed:voicepay` | `0.2.0` | 161,495 | `contract-voice-pay/` — **our own** | active · invoked · adversarially verified |

`515 → 516` because `0.1.0` referenced `{{profile.email_address}}`, which cannot resolve
([BUG-017](BUGS.md)); `0.1.1` narrows to fields that do.

`516 → 517` adds the marker-injection guard. Keeping 516 registered was deliberate: the
behavioural difference between the two is what makes the [BUG-003](BUGS.md) discriminator
work.

> **Note on these three ids.** Per BUG-003, a `script_version` pin does not reliably select
> the build it names — we proved 517 answering a `0.1.1` pin. Treat the **highest**
> registered version under a tail as the one that will actually execute, regardless of what
> you pin.

## Tenant quotas observed

```
max_contracts            10          max_maps                    50
max_map_keys             10,000      max_wasm_bytes              1,048,576
max_inline_bytes         10,485,760  max_cas_bytes               1,073,741,824
max_value_bytes          262,144     fuel_per_call_max           50,000,000
fuel_per_minute_max      500,000,000 writes_per_minute_max       600
outbox_calls_per_minute_max          10
```

Our two contracts use ~19% and ~15% of `max_wasm_bytes` respectively. `outbox_calls_per_minute_max: 10`
is the constraint that would bite first in a voice deployment — ten protected outbound
calls per minute is roughly ten concurrent calls each authorizing once.

## KV maps

| Map | Read ACL | Purpose |
|:--|:--|:--|
| `z:6ec29eeb…32ed:secrets` | `readers: { only: [511] }` | holds `duffel_api_key` for the flight contract |

`ppc-voice-pay` deliberately reads no KV secret — it imports only `tenant-context`,
`logging` and `http-with-placeholders`, keeping the capability surface minimal.

## Profile writes

| Tx | Fields committed | Resolvable via `{{profile.*}}` |
|:--|:--|:--|
| `tx:107:100057` | first_name, last_name, email_address, phone_number | first_name ✅ · last_name ✅ · email_address ❌ · phone_number ❌ |
| `tx:107:100071` | same | same |

The mismatch between what `submitUserInput` accepts and what the placeholder resolver can
find is [BUG-017](BUGS.md).

## Agent authorization grants

Both grants were issued to our own DID (self-invocation, which the docs endorse as the
fast path).

```jsonc
// flight
{ scriptName: "z:<tid>:flight",   functions: ["search-offers","book-offer"],
  allowedHosts: ["api.duffel.com"] }

// voicepay
{ scriptName: "z:<tid>:voicepay", functions: ["authorize-payment"],
  allowedHosts: ["postman-echo.com"] }
```

## Verified outcomes

**`flight` / `search-offers`** — dispatched into the TEE, read `duffel_api_key` from the
ACL'd map, performed real outbound HTTPS to `api.duffel.com`. Duffel returned
`401 access_token_not_found` (request_id `GMnF1mMwiWcBR68BZJ2I`) because the seeded key is
a placeholder. Every T3 mechanism in the chain functioned.

**`voicepay` / `authorize-payment`** — dispatched into the TEE, emitted two
`{{profile.*}}` markers, host resolved both, destination returned `200`, and **zero markers
survived to the destination**:

```json
{ "authorized": true, "markers_sent": 2, "markers_unresolved": 0,
  "fields": ["first_name","last_name"], "provider_status": 200 }
```

Held across 8 consecutive benchmark rounds — `markers_unresolved = 0` every time.

## Adversarial verification against the live network

`src/verify-voicepay.ts`, run against `contract_id 517`. Native tests prove the logic;
these prove the deployed contract and the platform's own controls.

| | Check | Result |
|:--|:--|:--|
| A | Happy path | ✅ `authorized: true`, markers 2/0, status 200 |
| B | Marker injected into `idempotency_key` | ✅ refused by the contract |
| C | Inline `card_number` in the payload | ✅ refused by the contract |
| D | Amount above the per-call ceiling | ✅ refused by the contract |
| E | Egress to a host outside the grant | ✅ **refused host-side** — `egress denied: 'example.com' is not on this agent's allowedHosts` |
| F | Pinned `0.1.1` with an injected marker | ⚠️ answered by the `0.2.0` guard — **BUG-003 confirmed** |

**E is the platform's own control, and it works.** The contract asked to reach
`example.com`; the host refused before anything left the enclave, because that host is not
in the signed grant. That is the egress allowlist doing exactly its job.

**F is the platform failing.** See [BUG-003](BUGS.md).

## Measured latency

| Path | Median | p95 | Notes |
|:--|--:|--:|:--|
| Session establishment | 1,515 ms | — | once per session; must be pre-warmed |
| Dispatch only, no egress | 151 ms | — | `flight`, malformed input rejected pre-egress |
| Dispatch + plain HTTP | 437 ms | — | `flight` / `search-offers`, no PII |
| **Dispatch + placeholder resolution** | **504 ms** | **798 ms** | `voicepay` / `authorize-payment`, n=8 |

Marker resolution costs roughly **67 ms** over plain HTTP. Reproduce with
`src/bench-latency.ts` and `src/bench-voicepay.ts`.
