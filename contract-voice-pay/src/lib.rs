//! ppc-voice-pay v0.1.0 — payment authorization for voice agents.
//!
//! ## Why this exists
//!
//! When a caller reads a card number to a voice agent, that number enters the
//! speech-to-text transcript, the model's context window, and every log and
//! trace downstream. Redacting afterwards does not help: the value was already
//! in the prompt. That is the reason voice agents route payments to a DTMF
//! fallback and eat the completion-rate hit.
//!
//! ## What it does instead
//!
//! The agent passes **no** cardholder data. It passes an amount and an
//! idempotency key. This contract templates `{{profile.<field>}}` markers into
//! the outbound payment request; the host resolves them from the calling
//! user's profile at dispatch, inside the enclave, gated by the user's
//! `agent-auth` grant. Cardholder data never enters WASM memory and never
//! enters the agent's context.
//!
//! ## The self-verifying part
//!
//! It would be easy to claim resolution happened. Instead the contract proves
//! it: it counts the markers it emitted, then inspects what the destination
//! actually received and counts how many markers survived. Zero survivors means
//! the host substituted every one.
//!
//! The proof is returned. The resolved values are **not** — handing those back
//! would deliver the PII straight to the agent and defeat the mechanism
//! entirely. `fields` names which profile fields were requested; it never
//! carries what they contained.
//!
//! ## Host capabilities
//!
//! ```json
//! { "host_capabilities": ["logging", "tenant_context", "http_with_placeholders"] }
//! ```
//!
//! Note `http_with_placeholders` is listed. The reference contract's README
//! omits it while its WIT imports it (BUG-005) — that omission makes the
//! PII-safe path undispatchable.

#![warn(clippy::style, missing_debug_implementations)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

use alloc::{format, string::String, vec::Vec};

pub const CONTRACT_VERSION: &str = "0.1.1";

/// The marker prefix the host substitutes on. Counting occurrences of this in
/// what the destination received is what turns "we believe it resolved" into
/// "we measured that it resolved".
pub const MARKER_PREFIX: &str = "{{profile.";

wit_bindgen::generate!({
    world: "voice-pay",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

/// Request from the agent. Deliberately narrow.
#[derive(Debug, serde::Deserialize)]
pub struct AuthorizeReq {
    /// Minor units. Integer on purpose — floats and money do not mix.
    pub amount_cents: u64,
    /// ISO-4217, e.g. "GBP".
    pub currency: String,
    /// Caller-supplied, so a retried turn cannot double-charge.
    pub idempotency_key: String,
    /// Destination endpoint. Must be on the grant's `allowedHosts`, which is
    /// enforced host-side — an unlisted host is refused as `egress-denied`
    /// before any request leaves the enclave.
    pub endpoint: String,
}

/// What the agent gets back: evidence, not data.
#[derive(Debug, serde::Serialize)]
pub struct AuthorizeProof {
    pub authorized: bool,
    /// How many `{{profile.*}}` markers this contract emitted.
    pub markers_sent: usize,
    /// How many survived to the destination. Must be 0 — anything else means
    /// the host did not substitute and a marker leaked upstream as a literal.
    pub markers_unresolved: usize,
    /// Which profile fields were requested. Names only, never values.
    pub fields: Vec<String>,
    pub provider_status: u16,
    /// Human-readable summary for the agent to speak aloud.
    pub summary: String,
}

/// Keys that must never appear in an agent-supplied payload. If a caller — or
/// a prompt-injected model — tries to pass cardholder data directly, this is
/// the door that stays shut.
const FORBIDDEN_KEYS: &[&str] = &[
    "card_number", "cardnumber", "pan", "cvv", "cvc", "card_cvc",
    "expiry", "exp_month", "exp_year", "date_of_birth", "dob",
    "ssn", "first_name", "last_name", "full_name", "email",
    "phone", "address", "passport_number", "account_number", "iban", "sort_code",
];

/// Reject any payload carrying PII-shaped keys, at any depth.
///
/// The point is not that a well-behaved agent would send them. The point is
/// that a misbehaving one cannot.
pub fn reject_inline_pii(raw: &[u8]) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_slice(raw)
        .map_err(|e| format!("authorize-payment: bad input: {e}"))?;

    fn walk(v: &serde_json::Value) -> Result<(), String> {
        match v {
            serde_json::Value::Object(map) => {
                for (k, inner) in map {
                    let lowered = k.to_ascii_lowercase();
                    if FORBIDDEN_KEYS.contains(&lowered.as_str()) {
                        return Err(format!(
                            "authorize-payment: bad input: field '{k}' looks like cardholder \
                             data. This contract never accepts PII as an argument — it is \
                             resolved host-side from the caller's profile."
                        ));
                    }
                    walk(inner)?;
                }
                Ok(())
            }
            serde_json::Value::Array(items) => items.iter().try_for_each(walk),
            _ => Ok(()),
        }
    }
    walk(&v)
}

/// Build the outbound payment body, templating profile markers.
///
/// Returns the serialized body and the field names referenced, so the caller
/// can report which fields were requested without ever seeing their contents.
pub fn build_payment_body(req: &AuthorizeReq) -> Result<(Vec<u8>, Vec<String>), String> {
    use serde_json::json;

    // Only `first_name` / `last_name` are used here, and that is a finding
    // rather than a preference. `submitUserInput` accepts `email_address` and
    // `phone_number` and commits them (we have the tx hash), but resolving
    // `{{profile.email_address}}` fails host-side with
    // `placeholder-unknown("email_address")`. The profile WRITE schema and the
    // placeholder RESOLUTION namespace do not agree — see BUG-017. Contact
    // fields appear to live under `verified_contacts.*`, which needs an OTP
    // round trip the docs never mention as a prerequisite for placeholders.
    let fields = ["first_name", "last_name"];

    let body = json!({
        "amount":          req.amount_cents,
        "currency":        req.currency,
        "idempotency_key": req.idempotency_key,
        "capture_method":  "automatic",
        // Resolved host-side at dispatch. The contract holds markers only.
        "billing_details": {
            "given_name":  "{{profile.first_name}}",
            "family_name": "{{profile.last_name}}",
        },
    });

    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    Ok((bytes, fields.iter().map(|s| String::from(*s)).collect()))
}

/// Count `{{profile.` occurrences. Used on both the emitted body and on what
/// the destination reports receiving.
pub fn count_markers(haystack: &[u8]) -> usize {
    let text = String::from_utf8_lossy(haystack);
    text.matches(MARKER_PREFIX).count()
}

/// Entry point. `input` is the raw JSON from `generic-input.input`.
pub fn authorize_payment(input: &[u8]) -> Result<Vec<u8>, String> {
    reject_inline_pii(input)?;

    let req: AuthorizeReq = serde_json::from_slice(input)
        .map_err(|e| format!("authorize-payment: bad input: {e}"))?;

    if req.amount_cents == 0 {
        return Err(String::from("authorize-payment: amount_cents must be > 0"));
    }
    if req.currency.len() != 3 {
        return Err(String::from("authorize-payment: currency must be ISO-4217"));
    }

    #[cfg(target_arch = "wasm32")]
    {
        let proof = authorize_wasm(req)?;
        serde_json::to_vec(&proof).map_err(|e| e.to_string())
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err(String::from(
            "authorize-payment performs host I/O and only runs on the wasm32 target",
        ))
    }
}

#[cfg(target_arch = "wasm32")]
use crate::host::interfaces::{http_with_placeholders as hwp, logging};

#[cfg(target_arch = "wasm32")]
fn authorize_wasm(req: AuthorizeReq) -> Result<AuthorizeProof, String> {
    let (body, fields) = build_payment_body(&req)?;
    let markers_sent = count_markers(&body);

    // Enclave-side only. This never leaves the TEE, and carries no values.
    let _ = logging::info(&format!(
        "authorize-payment: {} {} · {} markers emitted",
        req.amount_cents, req.currency, markers_sent
    ));

    let response = hwp::call(&hwp::Request {
        method: hwp::Verb::Post,
        url: req.endpoint.clone(),
        headers: Some(alloc::vec![
            (String::from("content-type"), String::from("application/json")),
            (String::from("idempotency-key"), req.idempotency_key.clone()),
        ]),
        payload: Some(body),
    })
    .map_err(|e| match e {
        hwp::HttpError::EgressDenied(host) => format!(
            "egress denied: '{host}' is not on this agent's allowedHosts. The grant \
             bounds where money can go, so this is the system working."
        ),
        hwp::HttpError::PlaceholderDenied(m) => format!("placeholder denied: {m}"),
        hwp::HttpError::PlaceholderUnknown(f) => format!(
            "profile field '{f}' is not set for the calling user — nothing to resolve"
        ),
        hwp::HttpError::PlaceholderNoUserContext => String::from(
            "no user context bound to this execution: there is no profile to resolve from. \
             The call must carry a pii_did.",
        ),
        hwp::HttpError::UpstreamError(reason) => format!("upstream error: {reason}"),
    })?;

    // The proof. The destination echoes back what it received; if the host did
    // its job, not one marker survived the trip.
    let markers_unresolved = count_markers(&response.payload);
    let authorized = (200..300).contains(&response.code) && markers_unresolved == 0;

    let summary = if markers_unresolved > 0 {
        format!(
            "FAILED: {markers_unresolved} of {markers_sent} markers reached the destination \
             unresolved — cardholder data was NOT substituted."
        )
    } else if authorized {
        format!(
            "Authorized {} {} — all {markers_sent} profile markers were resolved inside the \
             enclave. The agent never saw a value.",
            req.amount_cents, req.currency
        )
    } else {
        format!(
            "Provider returned {}. Markers resolved correctly ({markers_sent}/{markers_sent}).",
            response.code
        )
    };

    let _ = logging::info(&format!(
        "authorize-payment: status {} · {markers_unresolved} unresolved",
        response.code
    ));

    Ok(AuthorizeProof {
        authorized,
        markers_sent,
        markers_unresolved,
        fields,
        provider_status: response.code,
        summary,
    })
}

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::voice_pay::contracts::Guest for Component {
    fn authorize_payment(
        req: exports::z::voice_pay::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("authorize-payment: missing input")?;
        crate::authorize_payment(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> serde_json::Value {
        serde_json::json!({
            "amount_cents": 4250,
            "currency": "GBP",
            "idempotency_key": "call_01H_turn_7",
            "endpoint": "https://postman-echo.com/post"
        })
    }

    #[test]
    fn accepts_a_clean_request() {
        let raw = serde_json::to_vec(&valid()).unwrap();
        assert!(reject_inline_pii(&raw).is_ok());
    }

    #[test]
    fn rejects_a_card_number_in_the_payload() {
        let mut v = valid();
        v["card_number"] = serde_json::json!("4242424242424242");
        let raw = serde_json::to_vec(&v).unwrap();
        let err = reject_inline_pii(&raw).unwrap_err();
        assert!(err.contains("cardholder data"), "got: {err}");
    }

    #[test]
    fn rejects_pii_nested_inside_an_object() {
        let mut v = valid();
        v["customer"] = serde_json::json!({ "dob": "1990-01-01" });
        let raw = serde_json::to_vec(&v).unwrap();
        assert!(reject_inline_pii(&raw).is_err());
    }

    #[test]
    fn rejects_pii_nested_inside_an_array() {
        let mut v = valid();
        v["passengers"] = serde_json::json!([{ "first_name": "Jane" }]);
        let raw = serde_json::to_vec(&v).unwrap();
        assert!(reject_inline_pii(&raw).is_err());
    }

    #[test]
    fn rejects_pii_keys_regardless_of_case() {
        let mut v = valid();
        v["CVV"] = serde_json::json!("123");
        let raw = serde_json::to_vec(&v).unwrap();
        assert!(reject_inline_pii(&raw).is_err());
    }

    #[test]
    fn rejects_non_json() {
        assert!(reject_inline_pii(b"not json").unwrap_err().contains("bad input"));
    }

    #[test]
    fn body_carries_markers_and_never_literal_values() {
        let req: AuthorizeReq = serde_json::from_value(valid()).unwrap();
        let (body, fields) = build_payment_body(&req).unwrap();
        let text = String::from_utf8(body.clone()).unwrap();

        assert!(text.contains("{{profile.first_name}}"));
        assert!(text.contains("{{profile.last_name}}"));
        assert_eq!(count_markers(&body), 2, "two markers expected: {text}");
        assert_eq!(fields.len(), 2);

        // The amount is ours to send; the identity is not.
        assert!(text.contains("4250"));
    }

    #[test]
    fn counts_zero_markers_once_resolved() {
        let resolved = br#"{"billing_details":{"name":"Ada Lovelace","email":"ada@example.com"}}"#;
        assert_eq!(count_markers(resolved), 0);
    }

    #[test]
    fn rejects_zero_amount() {
        let mut v = valid();
        v["amount_cents"] = serde_json::json!(0);
        let raw = serde_json::to_vec(&v).unwrap();
        assert!(authorize_payment(&raw).unwrap_err().contains("must be > 0"));
    }

    #[test]
    fn rejects_malformed_currency() {
        let mut v = valid();
        v["currency"] = serde_json::json!("POUNDS");
        let raw = serde_json::to_vec(&v).unwrap();
        assert!(authorize_payment(&raw).unwrap_err().contains("ISO-4217"));
    }

    #[test]
    fn host_io_is_unavailable_natively() {
        let raw = serde_json::to_vec(&valid()).unwrap();
        assert!(authorize_payment(&raw).unwrap_err().contains("wasm32"));
    }
}
