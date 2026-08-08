# Building on Terminal 3

## Two contracts, seventeen defects, and one exfiltration path I found in my own code

**Hitansh Gopani** — AI/ML Engineer
gopanihitansh5@gmail.com · [@Hitansh54](https://x.com/Hitansh54)
8 August 2026

**Repository:** https://github.com/gopanihitansh5-collab/t3n-adk-submission
**Agent DID:** `did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed`
**Contracts:** `511` (flight, vendored) · `517` (voicepay, mine)
**Stack:** `@terminal3/t3n-sdk` 4.30.0 · Node 24.14.1 · Rust 1.97.1 · `wasm32-wasip2`

> This is the markdown mirror of `T3N-ADK-Report-Hitansh-Gopani.pdf`. Paste it into Google
> Docs (Tools → Preferences → Enable Markdown) and drop the images from `screenshots/` at
> the marked points.

---

## The short version

I completed the documented walkthrough, then wrote my own contract to test whether the
privacy guarantee actually holds under adversarial input.

The core mechanism works, and it is fast enough for a phone call. I registered a contract
that emits `{{profile.*}}` markers and measured that **zero of them reached the destination
unresolved** — the host substituted every one inside the enclave. Egress outside the signed
grant is refused. Dispatch costs 151 ms.

What does not work is the path a developer walks on day one: the published Quickstart throws
on its first call, the credit balance is unreachable through all four published surfaces,
and a *pinned* contract version silently executes whatever was registered most recently —
which I proved rather than inferred.

---

## What completed

*[Insert Fig. 1 — `docs/figures/fig1-architecture.png`]*

**The documented walkthrough, with their reference contract**

| Stage | Result | Detail |
|---|---|---|
| Claim API key + Agent DID | ✅ | resolved on testnet |
| Quickstart — authenticate | ✅ | after supplying an undocumented required field |
| Quickstart — credit balance | ❌ | broken on all four published surfaces |
| Walkthrough — build | ✅ | 194 KB component, 34 s |
| Walkthrough — test | ✅ | 7/7, documented command fails |
| Walkthrough — register | ✅ | `contract_id 511` |
| Walkthrough — invoke | ✅ | full TEE round trip to a live API |

**My own contract, built to test the guarantee under attack**

| Stage | Result | Detail |
|---|---|---|
| `ppc-voice-pay` — written | ✅ | Rust, 25 tests, plain `cargo test` |
| `ppc-voice-pay` — deployed | ✅ | `contract_id 517` |
| Privacy property — measured | ✅ | 2 markers sent, 0 unresolved |
| Adversarial verification | ✅ 5/5 | injection, PII, ceiling, egress all refused |
| Version pinning | ❌ | pinned version ran latest — proven |

*[Insert screenshots 01, 03, 04, 05, 06 from `screenshots/terminal/`]*

---

## The contract proves its own security property

Anyone can assert that the host resolved the markers. Rather than assert it, the contract
counts the `{{profile.*}}` markers it emits, then inspects what the destination *actually
received*. Zero survivors means every one was substituted inside the enclave.

```
OK   contracts.register(voicepay@0.2.0) → contract_id 517
OK   authorize-payment
     {"authorized":true,"markers_sent":2,"markers_unresolved":0,
      "fields":["first_name","last_name"],"provider_status":200}

  markers emitted by contract : 2
  markers reaching destination: 0
  PASS — all 2 markers were resolved host-side inside the enclave.
         The contract never held a value; the agent never saw one.
```

The proof is returned to the agent. The resolved values are **not** — handing those back
would deliver the PII straight to the model and defeat the mechanism entirely. `fields`
names which profile fields were requested; it never carries what they contained. The
property held on all eight benchmark rounds.

*[Insert screenshot 09-voicepay-proof.png]*

---

## The attack I found in my own contract

Agent-supplied strings end up inside the body the contract emits. Set `idempotency_key` to
`{{profile.ssn}}` and the host resolves it at dispatch exactly as it resolves the contract's
own markers — sending that value to the destination.

The contract never sees it. The marker count still comes back clean, because the injected
marker *resolves* and therefore leaves no trace. The audit row looks ordinary. If the
grant's `allowedHosts` is at all permissive, this is an exfiltration primitive.

**Placeholder resolution is a capability, and any caller-controlled string that reaches the
template is a way to invoke it.** The only safe rule is that markers originate from contract
code and nowhere else. v0.2.0 refuses caller markers at any depth. Any contract using
`http-with-placeholders` needs this guard, and the documentation never mentions it.

---

## Adversarial verification against the live network

*[Insert screenshot 12-voicepay-adversarial.png]*

| | Check | Result |
|---|---|---|
| A | Happy path | ✅ authorized, markers 2/0, status 200 |
| B | Marker injected into `idempotency_key` | ✅ refused |
| C | Inline `card_number` in the payload | ✅ refused |
| D | Amount above the per-call ceiling | ✅ refused |
| E | Egress to a host outside the grant | ✅ **refused host-side** |
| F | Pinned `0.1.1` with an injected marker | ⚠️ **BUG-003 confirmed** |

**E is Terminal 3 working.** The contract asked to reach `example.com`; the host refused
before anything left the enclave, because that host is not in the signed grant.

**F is Terminal 3 failing.**

---

## Version pinning does not pin

I originally filed this from Terminal 3's own documentation, which warns that registering a
new version can re-route pinned ones. Quoting a vendor's warning back at them is weak
evidence, so I built a discriminator.

Two registered versions of my contract differ in exactly one observable way: `0.1.1`
(id 516) has no marker-injection guard and accepts an injected marker; `0.2.0` (id 517)
refuses it. So invoking with `script_version` pinned to `0.1.1` and an injected marker
identifies which build actually ran.

```
// pinned to the OLD version, which should accept this input
script_version: "0.1.1",
input: { idempotency_key: "{{profile.first_name}}", ... }

RPC Error: contract error: authorize-payment: bad input:
  placeholder markers are not accepted from callers.
   ^ that message exists ONLY in 0.2.0
```

The pin was ignored and the newest build executed. No warning, no error, nothing in the
response indicating a different version answered. A tenant who pins a reviewed, audited
version of a payment contract will silently begin running whatever was registered most
recently — and pinning is precisely the mechanism people reach for to prevent that.

---

## The latency budget

A conversational turn degrades past 500–800 ms and breaks past ~1.5 s. I measured rather
than assumed — and the first measurement was of the wrong path.

| Path | Median | p95 | Verdict |
|---|--:|--:|---|
| TEE dispatch + WASM instantiation | 151 ms | — | sits anywhere |
| Dispatch + plain HTTPS, no PII | 437 ms | — | comfortable |
| **Dispatch + placeholder resolution** | **504 ms** | **798 ms** | degrading band |
| Session establishment | 1,515 ms | — | off the critical path |

My first benchmark timed `search-offers`, which uses plain `http` and carries no PII —
437 ms, comfortably inside a turn. But the payment path resolves markers, and that is extra
work inside the enclave. Measured properly on `authorize-payment` over eight rounds:
**504 ms median, 798 ms p95.** Marker resolution costs roughly **67 ms**.

That moves the verdict from "fits comfortably" to "lands in the degrading band." Still
shippable, but the agent needs to say *"one moment, authorizing that"* rather than going
silent, and the p95 is the number to design against.

The useful finding underneath: **the enclave is not the bottleneck.** Dispatch plus
instantiation is 151 ms; the rest is network egress you would pay anyway. Confidential
computing is not what costs you the conversation. Session establishment at ~1.5 s is the
real constraint — the agent must hold a session open while the phone is still ringing.

*[Insert screenshot 10-voicepay-latency.png]*

---

## Seventeen defects

Full repro, expected-versus-actual and workaround for each in `docs/BUGS.md`.

| # | Severity | Defect |
|---|---|---|
| 002 | Critical | Reference contract's README and WIT document **opposite** PII security models |
| 011 | Critical | Quickstart code doesn't run; the only available fix disables attestation |
| 003 | High | Pinned contract version silently runs latest — **proven, not quoted** |
| 013 | High | Credit balance unreachable from all 4 published surfaces |
| 017 | High | Profile write schema and placeholder resolver disagree on field names |
| 010 | High | Invocation needs an undocumented KV map with a `contract_id`-keyed ACL |
| 005 | High | Sample's capability manifest omits a capability its own WIT imports |
| 012 | High | `getBalance()` throws inside the SDK's own decrypt path |
| 014 | High | SDK ships a critical Zip Slip advisory in its dependency tree |
| 006 | Medium | `.cargo/config.toml` target pin breaks the documented `cargo test` |
| 015 | Medium | Shipped SDK is obfuscated, no source maps — 1.2 MB stack traces |
| 016 | Medium | `tenant.claim()` returns a bare `Internal error` |
| 009 | Medium | API key unrecoverable, no documented rotation path |
| 004 | Low | Docs state the wrong default environment for both SDK and CLI |
| 007 | Low | Sample repo carries three different version numbers |
| 001 | Low | `sandbox` / `testnet` / `production` naming inconsistent |
| 008 | Low | "No Rust or WASM knowledge required" contradicted by the next page |

### On severity discipline

Two of these were filed wrong and corrected downward after verification. BUG-001 was filed
Critical on the assumption `sandbox` and `testnet` were distinct environments; the SDK
showed they resolve to one URL. BUG-004 claimed the CLI dangerously defaults to production;
running it showed the opposite.

Both corrections are recorded with the original reasoning intact rather than quietly edited.
A severity rating is only worth reading if the ones that moved are shown moving — and
BUG-003 moved the other way, from quoted caveat to reproducible defect.

*[Insert screenshots 01–04 from `screenshots/` — live captures of the defects on Terminal 3's own pages]*

---

## What I would fix first

1. **Publish testnet trust-anchor values.** One paragraph removes the worst defect here and stops every new developer from disabling attestation as their opening move.
2. **Fix version pinning.** A pin that silently resolves to latest is worse than no pin, because it is trusted.
3. **Document marker injection.** Every contract using `http-with-placeholders` needs a guard against caller-supplied markers. Right now nothing says so, and the reference contract does not have one.
4. **Fix `token.get-usage`.** The headline offer is 20,000 credits that cannot be observed through any published surface.
5. **Add the KV map and ACL step to the invoke page.** Three commands, currently zero words.
6. **Ship source maps.** Isolating these defects meant reading type declarations, because the implementation is unreadable.

None of these are architectural. The hard part — confidential execution with host-resolved
secrets, an auditable grant model, and egress bounded by a signed capability — already
works, and I measured it working fast enough for a phone call. The gap is entirely in the
path a new developer walks on day one.

---

**Hitansh Gopani** · gopanihitansh5@gmail.com · [@Hitansh54](https://x.com/Hitansh54)
Source, defect report with repros, deployment record, verbatim transcripts and the
measurement harness: https://github.com/gopanihitansh5-collab/t3n-adk-submission
