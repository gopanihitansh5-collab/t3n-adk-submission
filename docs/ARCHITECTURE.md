# System design — what T3N actually is, and how the pieces fit

Written while completing the Walkthrough. The docs explain each step in isolation but never
draw the whole system, and several of the bugs in [BUGS.md](BUGS.md) are only obvious once
you can see it end to end.

---

## 1. A "contract" here is not a smart contract

This is the first thing that trips people up, and the Quickstart never states it plainly.

| | EVM smart contract | T3N TEE contract |
|---|---|---|
| Language | Solidity | **Rust** |
| Compiles to | EVM bytecode | **WASM component** (`wasm32-wasip2`) |
| Interface | ABI | **WIT world** |
| Executes on | Every validator, publicly | **Inside one enclave**, privately |
| Can call the internet | No (needs an oracle) | **Yes** — host-mediated, allowlisted |
| State | On-chain storage | Host KV maps, ACL'd per contract |
| Costs | Gas | Metered credits + a fuel budget |

The value proposition follows from row five: a T3N contract can hold a secret, call a real
API with it, and prove what it did — none of which an EVM contract can do.

---

## 2. Three identities, and why invocation needs all of them

The single biggest conceptual hurdle. A working invocation involves three distinct DIDs
that people assume are one.

```mermaid
graph LR
  subgraph Tenant["TENANT — owns the code"]
    T1["registers the WASM<br/>owns z:tid:* namespace<br/>owns the KV maps"]
  end
  subgraph User["USER — owns the data"]
    U1["signs agent-auth grant<br/>owns the profile PII<br/>can revoke anytime"]
  end
  subgraph Agent["AGENT — does the work"]
    A1["authenticates as itself<br/>calls contract functions<br/>never sees the PII"]
  end

  Tenant -->|"registers → contract_id"| C["Contract<br/>z:tid:flight@0.4.1"]
  User -->|"grants: which agent,<br/>which functions,<br/>which egress hosts"| C
  Agent -->|"invokes"| C
```

In this submission all three are the same DID — self-invocation, which the docs endorse as
the fast path. In production they separate: the tenant is your company, the user is your
customer, the agent is the thing you deployed.

**The authorization grant is the interesting part.** It is not a role, it is a
capability tuple, signed by the person whose data is at risk:

```typescript
{
  agentDid:     "did:t3n:…",        // who
  scriptName:   "z:<tid>:flight",   // may call what
  functions:    ["search-offers"],  // which entry points
  allowedHosts: ["api.duffel.com"], // and may talk to whom
}
```

An absent `allowedHosts` is read as **deny-all egress**, not allow-all. That default is the
right way round.

---

## 3. The lifecycle, and the step that isn't documented

```mermaid
flowchart TD
  A["1 · Write<br/>Rust crate + WIT world"] --> B["2 · Build<br/>cargo build --target wasm32-wasip2"]
  B --> C["3 · Test<br/>cargo test --lib --target x86_64…"]
  C --> D["4 · Register<br/>contracts.register → contract_id 511"]
  D --> E["5 · Create KV map<br/>maps.create('secrets')"]
  E --> F["6 · ACL the map<br/>readers = { only: [511] }"]
  F --> G["7 · Seed the secret<br/>entrySet('duffel_api_key', …)"]
  G --> H["8 · Grant<br/>agentAuthUpdate"]
  H --> I["9 · Invoke<br/>executeAndDecode"]

  style E stroke-dasharray: 5 5
  style F stroke-dasharray: 5 5
  style G stroke-dasharray: 5 5
```

**Steps 5–7 appear in no documentation** — they are [BUG-010](BUGS.md). Skipping them
produces a failure inside the enclave, which is the hardest place to debug:

```
access denied: TenantContract(did:t3n:<tid>/511) cannot read map "z:<tid>:secrets"
```

Note what the ACL is keyed on: the **numeric `contract_id`**, not the contract name. That
is the real reason `register-contract` tells you to keep every id — and that page never
explains why.

---

## 4. The mechanism that makes T3N worth using

`http-with-placeholders` is the whole product in one diagram. The contract composes a
request it cannot itself read the secrets of; the **host** substitutes them at dispatch,
inside the enclave.

```mermaid
sequenceDiagram
  participant Ag as Agent
  participant N as T3N node
  participant W as WASM contract<br/>(in TEE)
  participant H as Host<br/>(in TEE)
  participant X as External API

  Ag->>N: invoke book-offer { offer_id, passenger_id }
  Note over Ag,N: no PII in the request
  N->>W: dispatch with generic-input
  W->>W: template body with<br/>"{{profile.given_name}}" etc.
  Note over W: contract never holds<br/>real PII in WASM memory
  W->>H: http-with-placeholders(body)
  H->>H: resolve {{profile.*}} from the<br/>USER's profile — gated by the grant
  H->>X: real request, real values
  X-->>H: 201 booking created
  H-->>W: response, PII stripped
  W-->>Ag: { id, pnr, status }
```

Three properties fall out of this, and they are what a compliance reviewer cares about:

1. **PII never enters WASM memory** — so a contract bug cannot leak it.
2. **PII never enters the agent's context** — so a prompt-injection or a log dump cannot leak it.
3. **Resolution is gated by the user's grant** — so consent is enforced at dispatch, not by convention.

[BUG-002](BUGS.md) matters precisely because the reference README describes the *opposite*
of this diagram.

---

## 5. Trust model, and where the Quickstart breaks it

```mermaid
flowchart LR
  SDK["SDK client"] -->|"1 · handshake"| N["T3N node"]
  N -->|"2 · DKG attestation bundle<br/>(TDX quotes, peer ids, RTMR3)"| SDK
  SDK -->|"3 · verify against<br/>trustAnchor"| V{"anchor<br/>matches?"}
  V -->|yes| S["session established"]
  V -->|no| R["reject"]
  SDK -.->|"unsafe_trust_server: true"| S

  style R stroke:#a33
```

The dotted line is the problem. A `TrustAnchor` needs `expected_peer_ids` and
`rtmr3_allowlist` — the independent ground truth that stops an attacker with their own TDX
VM forging a valid-looking bundle for a key they control.

**Those values are published nowhere**, and the Quickstart omits the field entirely, so the
only way to complete the tutorial is the dotted path. Every developer's first act is
switching off the verification. That is [BUG-011](BUGS.md), and it is the single highest
-leverage fix on this list: publishing testnet anchor values closes it in one paragraph.

---

## 6. Proposed: voice-agent payment authorization

The use case for the bonus. Not built yet — this is the design I intend to implement with
the remaining credits.

**The problem.** When a caller reads a card number to a voice agent, it lands in the STT
transcript, the model's context window, and every log and trace downstream. Redacting after
the fact does not help: it was already in the prompt. This is the reason voice agents do
not take payments.

```mermaid
flowchart TD
  C["Caller speaks card number"] --> STT["Speech-to-text"]
  STT --> TOK["Tokenize at the edge<br/>→ {{profile.card_token}}"]
  TOK --> LLM["Agent reasoning<br/>context holds only the reference"]
  LLM --> INV["invoke authorize-payment<br/>{ amount, currency, token_ref }"]
  INV --> WC["TEE contract<br/>templates the Stripe intent"]
  WC --> HR["Host resolves {{profile.*}}<br/>bounded by the caller's grant"]
  HR --> ST["Stripe — real values"]
  ST --> LED["Audit row on the ledger<br/>= the compliance artifact"]

  style LLM stroke-dasharray: 5 5
  style WC stroke:#12606b
  style HR stroke:#12606b
```

The dashed node is the one that matters: **the transcript and the model context are now
safe to log**, because they never contained anything sensitive.

**Contract sketch**

```wit
interface contracts {
  /// Input:  { amount_cents, currency, token_ref, idempotency_key }
  /// Carries NO card data. Templates {{profile.card_token}} and
  /// {{profile.dob}} into the Stripe intent; host resolves at dispatch.
  /// Output: { intent_id, status, last4 }
  authorize-payment: func(req: generic-input) -> result<list<u8>, string>;
}
```

**Grant shape** — the caller bounds both amount and destination:

```typescript
{
  agentDid:     "did:t3n:<voice-agent>",
  scriptName:   "z:<tid>:voicepay",
  functions:    ["authorize-payment"],
  allowedHosts: ["api.stripe.com"],
  validUntilSecs: <call end + 300>,   // grant dies with the call
}
```

That `validUntilSecs` is the part I am most interested in testing: a payment authority that
expires when the phone call does, rather than persisting as a standing credential.

### Does it fit the latency budget? — measured, not assumed

This is where most voice-agent designs quietly fail, so I measured it rather than hand-waving.
A conversational turn has roughly **500–800 ms** before the interaction degrades, and past
**~1.5 s** it stops feeling like a conversation at all. A TEE contract call on the critical
path of a live phone call either fits that budget or the design is dead.

Measured against `z:<tid>:flight` on testnet, 5 rounds each
([`src/bench-latency.ts`](../src/bench-latency.ts)):

| Phase | Median | Min | Max |
|---|--:|--:|--:|
| Session establishment (handshake + authenticate) | **1,515 ms** | — | — |
| Contract dispatch, no egress | **151 ms** | 96 ms | 393 ms |
| Contract dispatch + real outbound HTTPS | **437 ms** | 418 ms | 455 ms |
| *Egress cost (delta)* | *286 ms* | | |

Three conclusions, and the first is the one that would have bitten me:

**1. The session must be pre-warmed before the call connects.** At ~1.5 s, handshake and
authentication cannot happen mid-conversation — that alone blows the entire budget. The
agent needs an authenticated T3N session established while the phone is still ringing, held
open for the duration. This is an architectural requirement, not an optimisation.

**2. A warm invocation with egress fits inside one turn — with thin headroom.** 437 ms
median sits under the 500 ms comfort threshold, so `authorize-payment` *can* run on the
critical path. But the measurement was taken against a Duffel `401`, which is a fast
rejection; a real Stripe authorization does more upstream work, and the max observed was
455 ms. I would treat 500 ms as the ceiling and instrument p95 in production before
committing to on-turn execution.

**3. Dispatch overhead alone is cheap.** 151 ms for TEE dispatch plus WASM instantiation is
low enough that the enclave is not the bottleneck — the network egress is. That is a good
result for T3: the confidential-computing layer is not what costs you the conversation.

### The unsolved part: barge-in during an in-flight authorization

Voice agents must handle interruption — the caller talks over the agent, and the agent stops
speaking immediately. That is well understood for speech. It is not well understood for a
payment that is already in flight.

If the caller says *"wait, no, cancel that"* 200 ms into a 437 ms authorization, the
authorization is going to complete. The agent must then reconcile a spoken cancellation
against a committed financial action:

```mermaid
stateDiagram-v2
  [*] --> Listening
  Listening --> Authorizing: caller confirms amount
  Authorizing --> Committed: contract returns intent_id
  Authorizing --> Contested: caller barges in mid-flight
  Contested --> Committed: too late to stop — must reverse
  Committed --> Reversing: void / refund the intent
  Reversing --> Listening: confirm reversal aloud
  Committed --> Listening: confirm success aloud
```

The honest design is **not** to try to cancel mid-flight. It is to make the window as small
as possible, treat every authorization as reversible for a bounded period, and have the
agent speak the outcome either way. `validUntilSecs` on the grant helps here: an authority
that expires with the call limits how much damage a confused turn can do.

**Open questions I would want T3's input on**

1. Is edge tokenization before the LLM the intended pattern, or does T3 expect the raw value to reach the profile store by another route?
2. Can `{{profile.*}}` resolve from a per-session profile rather than a durable user profile? A first-time caller has no stored profile.
3. Does the ledger audit row capture enough for PCI evidence, or is it a pointer to something richer?
4. Can an authenticated session be established ahead of time and held open across a call, or does something (idle timeout, key rotation) force a re-handshake? The 1.5 s cost makes this decisive for voice.
5. Is there a documented p95 for contract dispatch, and does it change under concurrent load? My 437 ms median came from a single warm session with no contention.
