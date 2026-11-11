//! Qasa ERP licence checks, compiled. A Node-API addon (`qasa_licence.node`) the app loads when it is present:
//! the signature checks, the machine ID, the sealed trial/clock state and the app-file hash live here as machine code
//! instead of readable JavaScript. Errors are never explained (a check either passes or returns nothing).

use base64::engine::general_purpose::{URL_SAFE_NO_PAD, URL_SAFE};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use hmac::{Hmac, Mac};
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use sha2::{Digest, Sha256};

/// The public keys Meroxis signs licence keys with (Ed25519, base64url) — the same list as
/// `LICENSE_PUBLIC_KEYS` in packages/server/src/license.ts (a test keeps them equal). Add a key here AND there.
const LICENCE_KEYS: &[&str] = &[
    // Meroxis' offline key (licensing/issue.mjs)
    "fEaDX9tiI7598uVB-udxo5b0FfwGjBC0W9l0QlURoe0",
    // the customer portal, my.qasaerp.com
    "2La4PsoYPOuS5wrVsEWrFLSDmi0q5xG5LZkJFwFycus",
];

/// The public keys that sign activation tokens (`QACT1.…`) — the portal's. When the portal gets an activation key of
/// its own, add its public half here (and keep the old one until every installation has re-activated).
const ACTIVATION_KEYS: &[&str] = &[
    // the customer portal, my.qasaerp.com
    "2La4PsoYPOuS5wrVsEWrFLSDmi0q5xG5LZkJFwFycus",
];

/// The public keys that sign the official builds' app.asar hash ("QINT1.<sha256 hex>", written by the desktop build's
/// afterPack hook as resources/app.asar.sig). Empty until Meroxis makes the build key (see README.md).
const INTEGRITY_KEYS: &[&str] = &[];

fn b64(text: &str) -> Option<Vec<u8>> {
    let t = text.trim_end_matches('=');
    URL_SAFE_NO_PAD.decode(t).ok().or_else(|| URL_SAFE.decode(text).ok())
}

fn key_of(text: &str) -> Option<VerifyingKey> {
    let bytes: [u8; 32] = b64(text)?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

fn verify_with(key: &VerifyingKey, message: &[u8], signature: &[u8]) -> bool {
    let Ok(sig) = <[u8; 64]>::try_from(signature) else { return false };
    key.verify_strict(message, &Signature::from_bytes(&sig)).is_ok()
}

/// "<tag>.<payload>.<signature>" signed by one of `keys`: the decoded payload (JSON text), else None.
fn signed_payload(token: &str, tag: &str, keys: &[&str]) -> Option<String> {
    let token: String = token.chars().filter(|c| !c.is_whitespace()).collect();
    let mut parts = token.split('.');
    let (t, payload, signature) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || t != tag {
        return None;
    }
    let body = format!("{t}.{payload}");
    let signature = b64(signature)?;
    if !keys.iter().filter_map(|k| key_of(k)).any(|k| verify_with(&k, body.as_bytes(), &signature)) {
        return None;
    }
    let text = String::from_utf8(b64(payload)?).ok()?;
    // only a JSON object counts as a payload
    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&text).ok()?;
    Some(text)
}

/// Strict Ed25519 verification with a given public key (base64url): for keys the binary doesn't embed (tests).
#[napi]
pub fn verify_ed25519(public_key: String, message: Buffer, signature: String) -> bool {
    match (key_of(&public_key), b64(&signature)) {
        (Some(k), Some(sig)) => verify_with(&k, &message, &sig),
        _ => false,
    }
}

/// A licence key "QASA1.<payload>.<signature>" signed with an embedded key: its payload (JSON text), else null.
/// The app still checks the payload's fields.
#[napi]
pub fn verify_licence(key: String) -> Option<String> {
    signed_payload(&key, "QASA1", LICENCE_KEYS)
}

/// An activation token "QACT1.<payload>.<signature>" from the portal, for this machine: its payload (JSON text) when
/// it is signed with an embedded activation key and its "machine" is `expected_machine`, else null.
#[napi]
pub fn verify_activation(token: String, expected_machine: String) -> Option<String> {
    let text = signed_payload(&token, "QACT1", ACTIVATION_KEYS)?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let machine = value.get("machine")?.as_str()?;
    if machine.is_empty() || machine != expected_machine {
        return None;
    }
    Some(text)
}

/// The embedded licence keys (for the test that keeps them equal to license.ts).
#[napi]
pub fn public_keys() -> Vec<String> {
    LICENCE_KEYS.iter().map(|k| k.to_string()).collect()
}

/// The embedded activation keys.
#[napi]
pub fn activation_keys() -> Vec<String> {
    ACTIVATION_KEYS.iter().map(|k| k.to_string()).collect()
}

/// The embedded build keys app.asar is checked against (empty: the check isn't configured in this build). The Pro
/// module asks, so a build that embeds one also needs resources/app.asar.sig, and removing the file doesn't pass.
#[napi]
pub fn integrity_keys() -> Vec<String> {
    INTEGRITY_KEYS.iter().map(|k| k.to_string()).collect()
}

#[cfg(windows)]
fn machine_secret() -> String {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY};
    use winreg::RegKey;
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags("SOFTWARE\\Microsoft\\Cryptography", KEY_READ | KEY_WOW64_64KEY)
        .and_then(|k| k.get_value::<String, _>("MachineGuid"))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn machine_secret() -> String {
    std::fs::read_to_string("/etc/machine-id")
        .or_else(|_| std::fs::read_to_string("/etc/hostname"))
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// This PC's ID for activation: Windows' MachineGuid with the installation's own ID, hashed (SHA-256, hex, 32 chars).
/// Stable across restarts and updates; changes with a reinstall of Windows or a new installation ID.
#[napi]
pub fn machine_id(install_id: String) -> String {
    let mut h = Sha256::new();
    h.update(b"qasa-machine-v1\0");
    h.update(machine_secret().as_bytes());
    h.update(b"\0");
    h.update(install_id.as_bytes());
    let digest = h.finalize();
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

type HmacSha256 = Hmac<Sha256>;

fn mac_for(key_material: &str) -> Option<HmacSha256> {
    let mut h = Sha256::new();
    h.update(b"qasa-seal-v1\0");
    h.update(machine_secret().as_bytes());
    h.update(b"\0");
    h.update(key_material.as_bytes());
    HmacSha256::new_from_slice(&h.finalize()).ok()
}

/// Seals a small state (the trial start, the latest date seen …) so editing it is detected: "<data>.<tag>",
/// base64url, HMAC-SHA256 with a key from `key_material` and this PC.
#[napi]
pub fn seal(data: String, key_material: String) -> String {
    let mut mac = match mac_for(&key_material) {
        Some(m) => m,
        None => return String::new(),
    };
    mac.update(data.as_bytes());
    format!("{}.{}", URL_SAFE_NO_PAD.encode(data.as_bytes()), URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

/// Opens what `seal` made with the same key material on the same PC: the data, else null (edited, or another PC).
#[napi]
pub fn open(sealed: String, key_material: String) -> Option<String> {
    let (data, tag) = sealed.split_once('.')?;
    let data = URL_SAFE_NO_PAD.decode(data).ok()?;
    let tag = URL_SAFE_NO_PAD.decode(tag).ok()?;
    let mut mac = mac_for(&key_material)?;
    mac.update(&data);
    mac.verify_slice(&tag).ok()?;
    String::from_utf8(data).ok()
}

/// SHA-256 (hex) of a file — the running app.asar — for comparing with the hash baked in at build time.
#[napi]
pub fn integrity(path: String) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Whether `path` (the running app.asar) is the file the official build signed: its SHA-256 signed as
/// "QINT1.<hex>" with an embedded build key. False when the file changed, the signature is wrong, or no build key is
/// embedded yet.
#[napi]
pub fn verify_integrity(path: String, signature: String) -> bool {
    let Some(hash) = integrity(path) else { return false };
    let Some(sig) = b64(&signature) else { return false };
    let message = format!("QINT1.{hash}");
    INTEGRITY_KEYS.iter().filter_map(|k| key_of(k)).any(|k| verify_with(&k, message.as_bytes(), &sig))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_tokens() {
        assert!(verify_licence("QASA1.e30".into()).is_none());
        assert!(verify_licence("QASA2.e30.AAAA".into()).is_none());
        assert!(verify_licence("".into()).is_none());
    }

    #[test]
    fn seal_round_trip_and_tamper() {
        let s = seal("2026-11-07".into(), "trial".into());
        assert_eq!(open(s.clone(), "trial".into()).as_deref(), Some("2026-11-07"));
        assert!(open(s.clone(), "other".into()).is_none());
        let (_, tag) = s.split_once('.').unwrap();
        let forged = format!("{}.{}", URL_SAFE_NO_PAD.encode(b"2030-01-01"), tag);
        assert!(open(forged, "trial".into()).is_none());
    }

    #[test]
    fn machine_id_is_stable() {
        assert_eq!(machine_id("a".into()), machine_id("a".into()));
        assert_ne!(machine_id("a".into()), machine_id("b".into()));
        assert_eq!(machine_id("a".into()).len(), 32);
    }
}
