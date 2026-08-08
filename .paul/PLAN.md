# T3N ADK Submission — Implementation Plan

> **Living document.** Update checkboxes as steps land. `.paul/STATE.md` holds the
> current position; this file holds the route. Never let them disagree.

**Goal:** Complete the T3 ADK Quickstart + Walkthrough under an Agent ID, evidence it
with screenshots and transcripts, file a high-quality bug report, and ship a public repo
+ public Google Doc — fast.

**Architecture:** A TypeScript SDK client (`@terminal3/t3n-sdk`) authenticates as the
tenant, registers a Rust→WASM component contract, registers an agent DID, grants that
agent authorization, and invokes the contract. Every command's output is tee'd to
`docs/RUN-LOG.md` so evidence accumulates during the run instead of being reconstructed
afterward.

**Tech Stack:** Node 24 + tsx + `@terminal3/t3n-sdk` · Rust 1.97.1 → `wasm32-wasip2` ·
`wit-bindgen` 0.49 · `wasm-tools` · git/gh

## Global Constraints

- **No secret ever reaches git.** The key lives in `$T3N_API_KEY`, sourced from
  `web3/apikeys.txt`, which sits *outside* the repo. `.gitignore` blocks `.env*`,
  `*.key`, `apikeys.txt` regardless.
- **Redact before commit.** DIDs are fine to publish; API keys and any `0x`-prefixed
  32-byte private key are not. Scrub `docs/RUN-LOG.md` before every commit.
- **Environment string is `testnet`** per the Quickstart — but see BUG-001; if the SDK
  rejects it, try `sandbox` and record which one actually works.
- **Record every `contract_id`** returned by registration. Per the docs, re-registering
  a tail can silently re-route pinned versions (BUG-003).
- **Every failure is a bug candidate.** Before working around anything, capture the exact
  command, full stderr, and SDK/crate version into `docs/BUGS.md`.
- **Timebox to submit.** Core path is Tasks 0–9. The bonus (Task 10) happens *after*
  submission.

---

## File Structure

```
t3n-adk-submission/
├── .paul/
│   ├── PROJECT.md          spec — what/why (stable)
│   ├── PLAN.md             this file — the route
│   └── STATE.md            living status (updated every task)
├── src/
│   ├── client.ts           shared auth bootstrap — exports getClient()
│   ├── quickstart.ts       Task 1 — auth, DID, credit balance
│   ├── register.ts         Task 4 — upload WASM, capture contract_id
│   ├── agent.ts            Task 5 — register agent DID + card
│   └── invoke.ts           Task 6 — grant auth, call the contract
├── contract/               z-tenant-flight (vendored, MIT, attribution kept)
├── docs/
│   ├── BUGS.md             the scored deliverable
│   ├── RUN-LOG.md          raw transcripts (redacted)
│   └── SUBMISSION.md       Google Doc source-of-truth (paste into Docs)
├── screenshots/            NN-description.png, referenced from SUBMISSION.md
├── .gitignore
└── README.md               reproduce-in-5-minutes
```

`client.ts` is split out because Tasks 1, 4, 5 and 6 all need the same handshake and
would otherwise each copy it — one auth path, one place for it to break.

---

### Task 0: Repo skeleton and secret hygiene

**Files:** Create `.gitignore`, `README.md` (stub), `docs/RUN-LOG.md`, `docs/BUGS.md`

- [ ] **Step 1: Init git and block secrets first** (before any key touches the machine's shell history)

```bash
cd "C:/Users/GAURAV/OneDrive/Desktop/PPC_Tech/web3/t3n-adk-submission"
git init
printf 'node_modules/\ntarget/\n.env*\n*.key\napikeys.txt\n*.wasm\n' > .gitignore
```

- [ ] **Step 2: Verify the ignore rules actually bite**

Run: `git check-ignore -v .env apikeys.txt node_modules`
Expected: each path prints a matching `.gitignore` rule. If any path prints nothing, the
rule is wrong — fix before continuing.

- [ ] **Step 3: Commit the skeleton**

```bash
git add .gitignore package.json
git commit -m "chore: repo skeleton with secret-blocking gitignore"
```

---

### Task 1: Quickstart — authenticate and read credit balance

**Files:** Create `src/client.ts`, `src/quickstart.ts`

**Interfaces:**
- Produces: `getClient(): Promise<{ t3n: T3nClient, tenantDid: string }>` — consumed by
  Tasks 4, 5, 6.

- [ ] **Step 1: Install the SDK**

```bash
npm install @terminal3/t3n-sdk tsx
npm pkg set type=module
```

- [ ] **Step 2: Write the shared auth bootstrap**

```typescript
// src/client.ts
import {
  T3nClient, setEnvironment, loadWasmComponent,
  eth_get_address, metamask_sign, createEthAuthInput,
} from "@terminal3/t3n-sdk";

setEnvironment("testnet"); // see BUG-001 — try "sandbox" if this rejects

export async function getClient() {
  const key = process.env.T3N_API_KEY;
  if (!key) throw new Error("T3N_API_KEY is not set");

  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(key);
  const t3n = new T3nClient({
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, key) },
  });

  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  return { t3n, tenantDid: did.value as string };
}
```

- [ ] **Step 3: Write the quickstart entrypoint**

```typescript
// src/quickstart.ts
import { getClient } from "./client.js";

const { t3n, tenantDid } = await getClient();
console.log("Connected as:", tenantDid);

const { balance } = await t3n.getUsage();
console.log("Credits available:", balance.available);
```

- [ ] **Step 4: Run it and capture the transcript**

```bash
export T3N_API_KEY="$(tr -d '[:space:]' < ../apikeys.txt)"
npx tsx src/quickstart.ts 2>&1 | tee -a docs/RUN-LOG.md
```

Expected: a `did:t3n:…` line and a credit balance near 20000.
If it fails: record the exact error in `docs/BUGS.md` before attempting any fix.

- [ ] **Step 5: Screenshot** the terminal showing DID + balance → `screenshots/01-quickstart-auth.png`

- [ ] **Step 6: Redact and commit**

Confirm `docs/RUN-LOG.md` contains no API key, then:

```bash
git add src/client.ts src/quickstart.ts docs/RUN-LOG.md package.json
git commit -m "feat: quickstart auth — tenant DID and credit balance"
```

---

### Task 2: Build the Rust contract to a WASM component

**Files:** Create `contract/` (vendored from `Terminal-3/z-tenant-flight`)

- [ ] **Step 1: Vendor the sample contract**

```bash
git clone --depth 1 https://github.com/Terminal-3/z-tenant-flight.git contract
rm -rf contract/.git
```

- [ ] **Step 2: Build the component**

```bash
cd contract && cargo build --target wasm32-wasip2 --release 2>&1 | tee -a ../docs/RUN-LOG.md
```

Expected: compiles clean. The `wasm32-wasip2` target is already installed on this machine
(verified 2026-08-08), so `rustup target add` should be a no-op — run it anyway to prove
the documented path works.

- [ ] **Step 3: Confirm the artifact exists**

Run: `ls -lh contract/target/wasm32-wasip2/release/z_tenant_flight.wasm`
Expected: a file on the order of a few hundred KB. Note the hyphen→underscore rename.

- [ ] **Step 4: Verify the WIT interface surfaced correctly**

```bash
cargo install wasm-tools   # skip if present
wasm-tools component wit contract/target/wasm32-wasip2/release/z_tenant_flight.wasm | tee -a docs/RUN-LOG.md
```

Expected: exports `contracts` with `search-offers` and `book-offer`; imports include
`host:interfaces/http-with-placeholders@2.1.0`. **That import is the evidence for
BUG-005** — the repo README's capability manifest omits it.

- [ ] **Step 5: Screenshot** the build + WIT output → `screenshots/02-contract-build.png`

- [ ] **Step 6: Commit** (the `.wasm` is gitignored; commit source only)

```bash
git add contract && git commit -m "feat: vendor and build z-tenant-flight WASM component"
```

---

### Task 3: Run the contract's native tests

- [ ] **Step 1: Run the tests exactly as the docs instruct**

```bash
cd contract && cargo test --lib 2>&1 | tee -a ../docs/RUN-LOG.md
```

**Prediction — this is expected to FAIL.** `contract/.cargo/config.toml` pins
`build.target = "wasm32-wasip2"`, so `cargo test` will try to *execute* wasm binaries
natively. If it fails, that is **BUG-006** and the docs' testing page is wrong. Capture
the full error verbatim.

- [ ] **Step 2: Confirm the diagnosis with an explicit native target**

```bash
cargo test --lib --target x86_64-pc-windows-gnu 2>&1 | tee -a ../docs/RUN-LOG.md
```

If this passes while Step 1 failed, BUG-006 is confirmed with a clean repro and a
workaround. Record both.

- [ ] **Step 3: Screenshot** both outcomes → `screenshots/03-contract-tests.png`

---

### Task 4: Register the contract

**Files:** Create `src/register.ts`

- [ ] **Step 1: Write the registration script**

```typescript
// src/register.ts
import { readFile } from "node:fs/promises";
import { getClient } from "./client.js";

const { t3n, tenantDid } = await getClient();
const wasm = await readFile(
  "contract/target/wasm32-wasip2/release/z_tenant_flight.wasm"
);

const { contract_id } = await t3n.contracts.register({
  tail: "flight",          // short on purpose — long tails break downstream ops
  version: "0.4.1",        // matches contract/Cargo.toml
  wasm,
});

console.log("tenant:", tenantDid);
console.log("contract_id:", contract_id);
```

- [ ] **Step 2: Register and capture the id**

```bash
npx tsx src/register.ts 2>&1 | tee -a docs/RUN-LOG.md
```

Expected: a numeric `contract_id`. **Write it into `.paul/STATE.md` immediately** — it is
needed by Task 6 and re-registering can silently re-route versions (BUG-003).

- [ ] **Step 3: Screenshot** → `screenshots/04-contract-registered.png`

- [ ] **Step 4: Commit**

```bash
git add src/register.ts docs/RUN-LOG.md
git commit -m "feat: register WASM contract, capture contract_id"
```

---

### Task 5: Register the Agent ID

The bounty says "under ID" — this is the step that creates it.

- [ ] **Step 1: Read the DID back from the network (never derive it locally)**

```bash
npx @terminal3/t3n-sdk whoami --env testnet 2>&1 | tee -a docs/RUN-LOG.md
```

Expected: `did:t3n:…`. Note the CLI defaults to `--env production` — omitting the flag
with a testnet key is a footgun (BUG-004), so the flag is always explicit here.

- [ ] **Step 2: Create the agent card**

```bash
npx @terminal3/t3n-sdk agent create-card --did "<AGENT_DID>"
```

Then edit `agent-card.json`: set `name` to `ppc-flight-agent`, replace the `description`
`REPLACE:` placeholder, and set the `DID` service endpoint to the real DID. Keep it
under 16 KiB.

- [ ] **Step 3: Publish the card**

```bash
npx @terminal3/t3n-sdk agent host-card --file agent-card.json --env testnet 2>&1 | tee -a docs/RUN-LOG.md
```

Expected: `card published: https://<node>/api/agent-card/did:t3n:…`

- [ ] **Step 4: Verify it resolves publicly**

```bash
curl "https://<node>/api/agent-card/<AGENT_DID>" | tee -a docs/RUN-LOG.md
```

- [ ] **Step 5: Screenshot** DID + published card URL → `screenshots/05-agent-id.png`

- [ ] **Step 6: Commit** `agent-card.json` (it is public by design — no secrets in it)

---

### Task 6: Authorize the agent and invoke the contract

**Files:** Create `src/invoke.ts`

- [ ] **Step 1: Grant the agent permission**

The user signs an `agent-auth-update` naming the agent, the contract, the allowed
functions, and the allowed outbound hosts. For self-invocation, set `agentDid` to your
own DID rather than registering a separate agent — the fastest path to a green run.

```typescript
// src/invoke.ts
import { getClient } from "./client.js";

const { t3n, tenantDid } = await getClient();
const agentDid = process.env.AGENT_DID ?? tenantDid; // self-invoke by default
const tid = tenantDid.split(":").pop();

await t3n.agentAuth.update({
  agentDid,
  grants: [{
    contract: `z:${tid}:flight`,
    functions: ["search-offers"],
    hosts: ["api.duffel.com"],
  }],
});

const result = await t3n.executeAndDecode({
  script: `z:${tid}:flight`,
  version: "0.4.1",
  function: "search-offers",
  input: {
    origin: "LHR", destination: "JFK",
    departure_date: "2026-09-15",
    cabin_class: "economy", adult_count: 1,
  },
});

console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 2: Seed the Duffel API key into the tenant KV map**

`search-offers` reads `duffel_api_key` from the `z:<tid>:secrets` KV map. Without it the
call fails inside the TEE. Obtain a Duffel **test** token, then seed it per the contract
README. If the SDK surface for this is undocumented in the ADK docs, **that is a bug** —
the walkthrough never mentions this prerequisite. File it.

- [ ] **Step 3: Invoke**

```bash
npx tsx src/invoke.ts 2>&1 | tee -a docs/RUN-LOG.md
```

Expected: JSON with an `offers` array. Any error here is high-value bug material — the
three-identity model is the most likely place for the docs to be incomplete.

- [ ] **Step 4: Screenshot** the decoded response → `screenshots/06-contract-invoked.png`

- [ ] **Step 5: Commit**

```bash
git add src/invoke.ts docs/RUN-LOG.md
git commit -m "feat: grant agent auth and invoke contract"
```

---

### Task 7: Consolidate the bug log

- [ ] **Step 1:** Fold every runtime failure from `docs/RUN-LOG.md` into `docs/BUGS.md`
      using the existing entry format (severity / location / repro / expected / actual /
      workaround).
- [ ] **Step 2:** Re-verify each pre-filed doc bug (BUG-001…008) against what actually
      happened. **Delete any that reality disproved** — a wrong bug costs more credibility
      than a missing one buys.
- [ ] **Step 3:** Sort by severity, renumber, commit.

---

### Task 8: README, submission doc, screenshots

- [ ] **Step 1:** Write `README.md` — what this is, prerequisites, the exact command
      sequence to reproduce, and a link to `docs/BUGS.md`.
- [ ] **Step 2:** Write `docs/SUBMISSION.md` — the narrative: what was built, screenshots
      inline in order, the bug table, and a closing section pitching the voice-agent use
      case.
- [ ] **Step 3:** Confirm every `screenshots/NN-*.png` is referenced from
      `docs/SUBMISSION.md`, and that no screenshot shows the API key.

---

### Task 9: Publish and submit

- [ ] **Step 1: Final secret sweep** — `git log -p | grep -iE 'api[_-]?key|0x[0-9a-f]{64}'`
      must return nothing. If it hits, rewrite history before pushing.
- [ ] **Step 2:** `gh repo create t3n-adk-submission --public --source=. --push`
- [ ] **Step 3:** Paste `docs/SUBMISSION.md` into a Google Doc, upload screenshots inline,
      set Share → Anyone with the link → Viewer.
- [ ] **Step 4:** **Submit.** Record the submission timestamp in `.paul/STATE.md`.

---

### Task 10 (BONUS — after submission): voice-agent payment authorization

- [ ] **Step 1:** Study [`Terminal-3/adk-circle-call-centre-agent-demo`](https://github.com/Terminal-3/adk-circle-call-centre-agent-demo)
      for the first-party call-centre + payments pattern.
- [ ] **Step 2:** Write `contract/ppc-voice-pay/` — a Rust contract exporting
      `authorize-payment(generic-input)`, templating `{{profile.card_token}}` and
      `{{profile.dob}}` so caller PII never enters WASM memory, calling the Stripe test
      merchant via `http-with-placeholders`.
- [ ] **Step 3:** Native tests first, mirroring the sample's pattern: assert the function
      **rejects** any input containing inline PII, and that `{{profile.*}}` markers stay
      literal in the templated body.
- [ ] **Step 4:** Build, register under tail `voicepay`, grant, invoke, screenshot.
- [ ] **Step 5:** Append a "Beyond the first contract" section to the Google Doc and send
      the follow-up.

---

## Self-Review

**Spec coverage:** Repo ✓ (T0, T9) · Doc ✓ (T8, T9) · Screenshots ✓ (every task) ·
Bugs ✓ (T7) · Quickstart ✓ (T1) · Walkthrough write/build/register/invoke/test ✓
(T2, T3, T4, T6) · Agent ID ✓ (T5) · Bonus ✓ (T10).

**Known gap:** Task 6 Step 2 depends on a Duffel test token we do not yet hold. If it
cannot be obtained quickly, fall back to invoking and documenting the *authorization*
path plus the resulting upstream error — the T3-side mechanics are what's being
evaluated, and the missing-prerequisite gap is itself a reportable bug.

**Type consistency:** `getClient()` returns `{ t3n, tenantDid }` and is consumed with
those exact names in Tasks 4 and 6. Contract tail `flight` and version `0.4.1` are used
identically in `register.ts` and `invoke.ts`.
