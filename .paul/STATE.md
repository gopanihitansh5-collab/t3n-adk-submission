# STATE — T3N ADK Submission

**Updated:** 2026-08-08 · **Phase:** core execution (pre-submission)

## Where we are

| Task | Status |
|---|---|
| Brainstorm + scope lock | ✅ done |
| PROJECT.md / PLAN.md / BUGS.md written | ✅ done |
| T0 repo skeleton | ⏳ next |
| T1 quickstart auth | ⬜ |
| T2 build contract | ✅ done — 194K component, built in 34s |
| T3 native tests | ✅ done — BUG-006 confirmed; 7/7 pass with workaround |
| T4 register contract | ✅ done — contract_id 511 |
| T5 agent ID | ✅ done — `whoami` resolves the DID on testnet |
| T6 authorize + invoke | ✅ done — full TEE round trip, see below |
| T7 consolidate bugs | ✅ 17 defects filed, 2 corrected down, BUG-003 proven |
| T8 README + submission doc | ✅ done — README, SUBMISSION.md, RUN-LOG.md, 4 screenshots |
| T9 publish | ✅ repo public; ⬜ Google Doc + submit form still on Hitansh |

## Published

- **GitHub (public):** https://github.com/gopanihitansh5-collab/t3n-adk-submission
- **Formatted document:** https://claude.ai/code/artifact/85409ea2-3c8f-4809-9a26-ba58f60c1c34
  (private by default — share from the page's share menu, or paste
  `docs/SUBMISSION.md` into a Google Doc if a Docs link is needed specifically)

## Remaining

1. Create the public Google Doc from `docs/SUBMISSION.md` + `screenshots/`, set
   Share → Anyone with the link.
2. Submit both links.
3. **Rotate the GitHub PAT** — it was pasted in plaintext into a chat transcript.
4. Bonus (post-submission): build `ppc-voice-pay` per PLAN.md Task 10.

## Walkthrough completed end-to-end ✅

`search-offers` was dispatched into the TEE and reached the real Duffel API:

1. `agentAuthUpdate` — grant accepted (functions + `allowedHosts: ["api.duffel.com"]`)
2. TEE dispatch — `TenantContract(did:t3n:…/511)` instantiated
3. KV read — `duffel_api_key` read from `z:<tid>:secrets` after the ACL was set to
   `readers: { only: [511] }`
4. Egress — real outbound HTTPS to `api.duffel.com`
5. Duffel replied `HTTP 401 access_token_not_found` (request_id `GMnF1mMwiWcBR68BZJ2I`)

The 401 is our placeholder credential, not a T3 failure. Every Terminal 3 mechanism —
registration, agent auth, TEE dispatch, KV ACL, egress allowlist, HTTP — is proven working.
Supplying a real Duffel test token is the only thing between this and live offers.
| T10 bonus voice-pay contract | ⬜ post-submission |

## Key facts (do not re-derive)

- **Tenant DID:** `did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed`
- **tid** (for `z:<tid>:<tail>` script names): `6ec29eeb5cb122d05e006391d2c954b2390032ed`
- **API key:** in `web3/new.txt` and `web3/apikeys.txt` — **never commit**; export as
  `$T3N_API_KEY`. Both files live outside the repo.
- **Credits:** 20,000 T3N (≈25 agents / ~5,000 protected actions) — unverified until T1 runs
- **Claim/community link:** https://go.terminal3.io/adk-community
- **Contract tail:** `flight` · **version:** `0.4.1` · **contract_id: `511`** ✅
- **Canonical name:** `z:6ec29eeb5cb122d05e006391d2c954b2390032ed:flight`
- **WASM:** `contract/target/wasm32-wasip2/release/z_tenant_flight.wasm` — 197,904 bytes
  (quota `max_wasm_bytes` = 1,048,576, so ~19% used)
- **Tenant standing:** `label: testnet-dev`, `status: active`, `max_contracts: 10`
- **Also present under this tenant:** `z:…:flight-walkthrough` — pre-existing, not
  registered by this run. Origin unknown; do not assume it is ours.
- **Derived eth address:** `0xe85e19061e3e7b38073d9a119ca3c32f45c0066d`
- **Agent DID:** _(pending T5)_
- Toolchain verified present: Rust 1.97.1 + `wasm32-wasip2`, Node 24.14.1, gh 2.96.0

## Open risks

1. **Duffel test token not held.** Needed to seed `z:<tid>:secrets` before `search-offers`
   returns real data (BUG-010). Fallback: document the authorization path plus the upstream
   error, which still evidences the T3-side mechanics.
2. **Screenshots need the user.** Terminal captures must be taken by Hitansh; I cannot
   capture the desktop. Browser-side pages I can capture.
3. **Claim-page screenshot is unrecoverable** — key already claimed, that screen is gone.
   Substitute: terminal output proving DID + credit balance.

## Decisions log

- **2026-08-08** — Complete and publish the core walkthrough first, then extend. The
  evaluation is only credible once the documented path actually runs end to end.
- **2026-08-08** — Bonus use case = voice-agent payment authorization (VoxGate tie-in),
  building against `Terminal-3/adk-circle-call-centre-agent-demo`.
- **2026-08-08** — Vendor `z-tenant-flight` rather than reimplement; MIT, attribution kept.
- **2026-08-08** — 10 bugs pre-filed from docs/repo review before running any code.
  Each must be re-verified at T7; any disproved by reality gets deleted, not softened.
