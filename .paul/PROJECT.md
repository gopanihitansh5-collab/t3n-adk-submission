# PROJECT — T3N ADK Integration &amp; Evaluation

**Status:** active · **Started:** 2026-08-08 · **Owner:** Hitansh Gopani (Pitch Perfekt Collective)

## What this is

A first integration against the Terminal 3 ADK, evaluated as a prospective platform for
building agents that handle sensitive data. Under an Agent ID: complete the Quickstart and
the Walkthrough from the T3 docs, evidence the completion, and report every defect found
along the way.

## Deliverables — all three required for the package to be complete

1. **Public GitHub repo** — working code, defect report, run transcripts, screenshots
2. **Public shareable document** (Google Doc / PDF) — the narrative writeup, with the
   screenshots embedded and the defect table inline
3. **Screenshots + defect log** — evidence that each stage actually completed, and every
   defect found on the way through

## Quality bar

| Dimension | Standard held to |
|---|---|
| **Turnaround** | Complete the core walkthrough and publish, then extend. Don't hold the report hostage to the extension work. |
| **Documentation** | Reproducible-in-5-minutes README, tee'd terminal transcripts as primary evidence, screenshots numbered and cross-referenced. |
| **Defect reporting** | Every bug filed with severity, exact location, repro, expected vs actual, and a workaround. Correctness over volume — no speculative bugs. |
| **Depth** | Go past the reference contract into a real use case: voice-agent payment authorization. |

## Scope decision (locked 2026-08-08)

**Core walkthrough first, extension after.** The evaluation is only credible once the
documented path is actually completed end to end; the second contract builds on that
rather than substituting for it.

## Use case under evaluation (locked 2026-08-08)

**Voice-agent payment authorization.** A phone-booking agent where the caller's card
and DOB never enter LLM context — they exist only as `{{profile.*}}` placeholders that
the host resolves inside the TEE at dispatch time, closed out against the Stripe-backed
test merchant.

Chosen because it maps onto my own voice-agent work (VoxGate) — a real constraint I hit
in production, not a toy — and because Terminal 3 publishes a first-party reference at
[`Terminal-3/adk-circle-call-centre-agent-demo`](https://github.com/Terminal-3/adk-circle-call-centre-agent-demo)
to build against.

## Architecture / what actually gets built

T3 "contracts" are **not** EVM smart contracts. A TEE contract is a Rust crate compiled
to a **WASM component** targeting `wasm32-wasip2`, exporting a `contracts` WIT interface
and importing only the host capabilities it declares. It runs inside the Trinity TEE.

The privacy mechanism that matters: the contract never sees PII. It templates
`{{profile.<field>}}` markers into an outbound request body, and the host resolves them
from the calling user's profile at dispatch time via `http-with-placeholders`. PII never
enters WASM memory.

Invocation requires **three distinct identities**:

- **Tenant** — owns the contract (our claimed API key → `did:t3n:…`)
- **Agent** — executes functions, authenticates as itself
- **User** — signs an `agent-auth-update` grant naming which agent may call which
  functions and contact which outbound hosts

## Environment facts (verified 2026-08-08)

- Rust 1.97.1, `wasm32-wasip2` target **already installed**
- Node v24.14.1, npm 11.11.0, git 2.53.0, gh 2.96.0
- Sample contract [`Terminal-3/z-tenant-flight`](https://github.com/Terminal-3/z-tenant-flight)
  is public (MIT), v0.4.1
- API key already claimed, stored at `web3/apikeys.txt` (never committed; read via
  `$T3N_API_KEY`)

## Non-goals

- Real Duffel or Stripe production transactions — sandbox/test keys only
- Reimplementing the sample contract from scratch; we build on it and then write our own
- Any secret in git history

## Related

- `.paul/PLAN.md` — task-by-task implementation plan
- `.paul/STATE.md` — living status, updated as work lands
- `docs/BUGS.md` — the defect report
