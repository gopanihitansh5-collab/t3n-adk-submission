# Terminal 3 ADK — Completed Quickstart & Walkthrough

**Submitted by:** Hitansh Gopani — AI/ML Engineer, Pitch Perfekt Collective
**Date:** 8 August 2026
**Repo:** https://github.com/gopanihitansh5-collab/t3n-adk-submission
**Agent / Tenant DID:** `did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed`

---

## Summary

I completed the Quickstart and the full five-stage Walkthrough (write → build → register →
invoke → test) under my T3N Agent ID, and filed **16 bugs**.

The headline result: a Rust TEE contract compiled to a WASM component, registered as
`contract_id 511`, granted to an agent identity, and invoked — with the enclave making a
real outbound HTTPS call to the Duffel API through the host egress allowlist.

The headline problem: **the published Quickstart code does not run**, and the only way to
make it run is to disable the remote-attestation verification that Terminal 3 exists to
provide.

| Stage | Outcome |
|---|---|
| Claim API key + DID | ✅ |
| Quickstart — authenticate | ✅ (after fixing an undocumented required field) |
| Quickstart — read credit balance | ❌ **broken on all four published surfaces** |
| Walkthrough — write contract | ✅ |
| Walkthrough — build to `wasm32-wasip2` | ✅ 194 KB component, 34 s |
| Walkthrough — test | ✅ 7/7 (documented command fails; workaround needed) |
| Walkthrough — register | ✅ `contract_id 511` |
| Walkthrough — invoke | ✅ full TEE round trip to a live external API |

### Evidence

Captured live from Terminal 3's own published pages — these are the source documents, not
my reproduction of them.

| Screenshot | Shows |
|---|---|
| `01-bug002-readme-claims-full-PII.jpg` | `z-tenant-flight` README: "`book-offer` — POST to Duffel `/air/orders` **with full passenger PII**", and the header reading **v0.3.0** against a `Cargo.toml` of `0.4.1` (BUG-002, BUG-007) |
| `02-bug002-bug005-privacy-guarantee-and-missing-capability.jpg` | The README's "Privacy guarantee: passenger PII … **is passed in by the agent**", directly above a `host_capabilities` manifest that omits `http_with_placeholders` (BUG-002, BUG-005) |
| `03-bug002-wit-says-carries-NO-PII.jpg` | `wit/world.wit` line 49: "**Carries NO passenger PII**: the contract templates `{{profile.<field>}}` markers … the host resolves them" — the exact contradiction (BUG-002) |
| `04-bug011-quickstart-snippet-has-no-trustAnchor.jpg` | The Quickstart's published `new T3nClient({ wasmComponent, handlers })` — **no `trustAnchor`**, the omission that makes the tutorial throw. Also visible: the inline comment "the SDK defaults to production", which is false (BUG-011, BUG-004) |

Terminal transcripts for every command are reproduced verbatim in
[`docs/RUN-LOG.md`](RUN-LOG.md).

---

## The walkthrough, end to end

After registration I authorized my own DID as the calling agent, scoped to two functions
and a single egress host:

```typescript
await t3n.agentAuthUpdate({
  agents: [{
    agentDid: tenantDid,
    scripts: [{
      scriptName: "z:6ec29eeb…32ed:flight",
      versionReq: null,
      functions: ["search-offers", "book-offer"],
      allowedHosts: ["api.duffel.com"],
    }],
  }],
  discoverDids: [tenantDid],
});
```

Invoking `search-offers` then produced this, which is worth reading closely:

```
RpcError: contract error: Duffel offer-request failed: HTTP 401 —
{"errors":[{"title":"Access token not found","type":"authentication_error",
"code":"access_token_not_found"}],"meta":{"request_id":"GMnF1mMwiWcBR68BZJ2I","status":401}}
```

That is a **success**, not a failure. The 401 comes from Duffel, not from Terminal 3 — it
is rejecting my placeholder API token. To produce it, the platform had to: dispatch the
contract into the enclave, instantiate the WASM component, resolve its host capabilities,
read a secret from an ACL-gated KV map, and make a real outbound HTTPS request through the
egress allowlist. Every T3 mechanism in the chain works. Only the third-party credential
was fake.

---

## Bugs

Full detail with repros in `docs/BUGS.md`. Ordered by severity.

| # | Severity | Summary |
|---|---|---|
| 002 | **Critical** | Sample contract's README and WIT document **opposite** PII security models |
| 011 | **Critical** | Quickstart code does not run — `trustAnchor` required but undocumented; the only workaround disables attestation |
| 013 | **High** | Credit balance broken on all 4 surfaces — SDK and CLI both send a sealed blob where the node expects a struct |
| 012 | **High** | `getBalance()` throws inside the SDK's own decrypt path |
| 010 | **High** | Invocation needs an undocumented KV map whose ACL is keyed on `contract_id` |
| 005 | **High** | Sample's capability manifest omits `http_with_placeholders`, which its WIT imports |
| 003 | **High** | Registering a new version silently re-routes *pinned* older versions |
| 014 | **High** | SDK ships a **critical** Zip Slip advisory (`decompress`) in its dependency tree |
| 006 | Medium | `.cargo/config.toml` target pin breaks the documented `cargo test` |
| 009 | Medium | API key unrecoverable, no rotation path documented |
| 015 | Medium | Shipped SDK is obfuscated with no source maps — 1.2 MB stack traces |
| 016 | Medium | `tenant.claim()` returns a bare `Internal error` |
| 001 | Low | `sandbox` / `testnet` / `production` naming inconsistent across surfaces |
| 004 | Low | Docs state the wrong CLI default and omit a supported environment |
| 007 | Low | Sample repo version drift: README 0.3.0, Cargo.toml 0.4.1, WIT 0.4.0 |
| 008 | Low | "No Rust or WASM knowledge required" contradicted by the next page |

**Two bugs were corrected downward after verification.** BUG-001 was filed as High on the
assumption `sandbox` and `testnet` were different environments; checking the SDK at runtime
showed `NODE_URLS.sandbox === NODE_URLS.testnet`, so nobody is actually broken. BUG-004 was
filed claiming the CLI dangerously defaults to production; running `t3n --help` showed it
defaults to testnet and the *docs* are wrong. Both are recorded with their original
reasoning intact rather than quietly edited — a bug report is only useful if its severities
can be trusted.

### The two that matter most

**BUG-011 — the Quickstart is unrunnable, and the fix is to turn off the security.**
`T3nClientConfig.trustAnchor` is a required field; the SDK's own comment says it is
required "precisely so no caller can omit it by accident — bypassing verification must be
a visible, grep-able choice." The published Quickstart omits it. A real anchor needs
`expected_peer_ids` and `rtmr3_allowlist`, and **those values appear nowhere** — not in the
docs, not in the SDK reference, not as an exported constant. So every developer completing
your Quickstart will write `unsafe_trust_server: true` and unknowingly disable DKG
attestation. Publishing testnet anchor values would close this.

**BUG-002 — the reference contract's README contradicts its own interface.** The README
says `book-offer` is called "with full passenger PII … passed in by the agent." The WIT
says it "carries **NO** passenger PII" and uses host-resolved `{{profile.*}}` placeholders.
The crate's own test suite settles it — `book_offer_rejects_inline_pii_fields` passes — so
the WIT is right and the README documents a model the code deliberately refuses. Since this
is the flagship privacy guarantee, the README is teaching newcomers the one pattern the
product exists to prevent.

---

## Beyond the first contract: voice-agent payment authorization

The reference contract protects PII in flight booking. The same primitive solves a problem
we hit in production at Pitch Perfekt Collective, where we build voice agents.

When a caller reads a card number to a voice agent, that number enters the speech-to-text
transcript, the LLM context window, and every log and trace downstream. Redaction after the
fact does not help — the data was already in the prompt. This is the single biggest blocker
to voice agents touching payments.

`http-with-placeholders` inverts it. The agent never receives the card at all:

```
caller speaks  →  STT  →  agent reasons over "{{profile.card_token}}"
                              ↓
                        TEE contract templates the Stripe request
                              ↓
                        host resolves {{profile.*}} at dispatch
                              ↓
                        Stripe sees real values; agent never did
```

A contract exporting `authorize-payment(generic-input)` would template
`{{profile.card_token}}` and `{{profile.dob}}` into a Stripe intent, with the caller's
`agent-auth` grant bounding both the amount and the egress host. The LLM context contains
only opaque references, so the transcript is safe to log, and the audit row on the ledger
is the compliance artifact.

This maps directly onto Terminal 3's own
[`adk-circle-call-centre-agent-demo`](https://github.com/Terminal-3/adk-circle-call-centre-agent-demo),
and it is what I intend to build next with the remaining credits. I will follow up with the
contract and a recorded demo.

---

## What would have made this faster

1. **Publish testnet trust-anchor values.** One paragraph removes the worst bug here.
2. **Fix `token.get-usage`.** Nobody can verify they received the credits the offer is built on.
3. **Add the KV-map + ACL step to the invoke page.** It is three commands and currently zero words.
4. **Ship source maps.** Debugging obfuscated single-line bundles is what made these bugs slow to isolate.

Happy to go deeper on any of these — `devrel@terminal3.io` has my details.
