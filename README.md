# T3N ADK — Quickstart + Walkthrough completion

A completed run of the [Terminal 3 Agent Developer Kit](https://terminal3.io/products/agent-developer-kit)
Quickstart and Walkthrough, with a [bug report](docs/BUGS.md) of everything that broke
along the way.

**Result:** a Rust TEE contract compiled to a WASM component, registered on T3N testnet as
`contract_id 511`, authorized to an agent identity, and invoked end-to-end — reaching the
real Duffel API from inside the enclave.

| | |
|---|---|
| Tenant / Agent DID | `did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed` |
| Contract | `z:6ec29eeb…32ed:flight` @ `0.4.1` · `contract_id 511` |
| Network | testnet — `https://cn-api.sg.testnet.t3n.terminal3.io` |
| SDK | `@terminal3/t3n-sdk` v4.30.0 |
| Toolchain | Node v24.14.1 · Rust 1.97.1 · `wasm32-wasip2` |
| Bugs filed | **16** — 2 of them corrected downward after verification |

## What actually runs

```
src/client.ts        shared auth bootstrap (handshake + authenticate)
src/quickstart.ts    Quickstart — DID + credit balance
src/register.ts      register the WASM component  → contract_id
src/seed-secrets.ts  create + ACL the secrets KV map   (undocumented — BUG-010)
src/invoke.ts        agent-auth grant, then invoke the contract
src/probe-balance.ts diagnostic isolating BUG-012 / BUG-013
contract/            z-tenant-flight (MIT, Terminal-3) built to wasm32-wasip2
```

## Reproduce in five minutes

```bash
npm install @terminal3/t3n-sdk
printf 'T3N_API_KEY=0x<your key from the claim page>\n' > .env

# 1. Quickstart — authenticate, print your DID
node --env-file=.env src/quickstart.ts

# 2. Build the Rust contract to a WASM component
cd contract && cargo build --target wasm32-wasip2 --release && cd ..

# 3. Contract unit tests — note the explicit --target (BUG-006)
cd contract && cargo test --lib --target x86_64-pc-windows-gnu && cd ..

# 4. Register it — record the contract_id it prints
node --env-file=.env src/register.ts

# 5. Create + ACL the secrets map (edit CONTRACT_ID first)
node --env-file=.env src/seed-secrets.ts

# 6. Authorize the agent and invoke
node --env-file=.env src/invoke.ts
```

`tsx` is **not** required — Node 24 strips TypeScript types natively. (Installing `tsx`
fails outright in a OneDrive-synced directory: its `esbuild` postinstall cannot spawn
its binary.)

## Three things that will stop you

Full detail in [docs/BUGS.md](docs/BUGS.md); these are the ones that cost the most time.

1. **The Quickstart snippet does not run.** `T3nClientConfig.trustAnchor` is required and
   the published code omits it, so `handshake()` throws
   `Cannot read properties of undefined (reading 'unsafe_trust_server')`. No testnet
   anchor values are published anywhere, so the only way through is
   `trustAnchor: { unsafe_trust_server: true }` — which disables the attestation
   verification the product exists to provide. **(BUG-011)**

2. **You cannot check your credit balance.** All four routes fail — SDK `getBalance()`,
   SDK `getUsage()`, CLI `t3n token balance`, CLI `t3n token usage` — against a session
   that is otherwise healthy. **(BUG-012, BUG-013)**

3. **Invocation needs an undocumented KV map with a contract-id ACL.** The map's `readers`
   must name the numeric `contract_id`, not the contract name, and an omitted `readers`
   silently means deny-all. **(BUG-010)**

## Credits

`contract/` is [`Terminal-3/z-tenant-flight`](https://github.com/Terminal-3/z-tenant-flight)
(MIT), vendored unmodified. Everything in `src/` is ours.
