# STATE — T3N ADK Submission

**Updated:** 2026-08-08 · **Phase:** core execution (pre-submission)

## Where we are

| Task | Status |
|---|---|
| Brainstorm + scope lock | ✅ done |
| PROJECT.md / PLAN.md / BUGS.md written | ✅ done |
| T0 repo skeleton | ⏳ next |
| T1 quickstart auth | ⬜ |
| T2 build contract | ⬜ |
| T3 native tests | ⬜ |
| T4 register contract | ⬜ |
| T5 agent ID | ⬜ |
| T6 authorize + invoke | ⬜ |
| T7 consolidate bugs | ⬜ |
| T8 README + submission doc | ⬜ |
| T9 publish + SUBMIT | ⬜ |
| T10 bonus voice-pay contract | ⬜ post-submission |

## Key facts (do not re-derive)

- **Tenant DID:** `did:t3n:6ec29eeb5cb122d05e006391d2c954b2390032ed`
- **tid** (for `z:<tid>:<tail>` script names): `6ec29eeb5cb122d05e006391d2c954b2390032ed`
- **API key:** in `web3/new.txt` and `web3/apikeys.txt` — **never commit**; export as
  `$T3N_API_KEY`. Both files live outside the repo.
- **Credits:** 20,000 T3N (≈25 agents / ~5,000 protected actions) — unverified until T1 runs
- **Claim/community link:** https://go.terminal3.io/adk-community
- **Contract tail:** `flight` · **version:** `0.4.1` · **contract_id:** _(pending T4)_
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

- **2026-08-08** — Ship core fast, submit, then follow up with the bonus. Time-to-submit is
  explicitly scored; the bonus is additive, not gating.
- **2026-08-08** — Bonus use case = voice-agent payment authorization (VoxGate tie-in),
  building against `Terminal-3/adk-circle-call-centre-agent-demo`.
- **2026-08-08** — Vendor `z-tenant-flight` rather than reimplement; MIT, attribution kept.
- **2026-08-08** — 10 bugs pre-filed from docs/repo review before running any code.
  Each must be re-verified at T7; any disproved by reality gets deleted, not softened.
