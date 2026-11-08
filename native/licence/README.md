# qasa-licence — the licence checks, compiled

A small Rust library built as a Node-API addon (`qasa_licence.node`). The app loads it with
`loadNative()` from `packages/server/src/native-licence.ts`; official Windows builds ship it next to `app.asar`
(`resources/qasa_licence.node`). It moves the checks crackers look for out of readable JavaScript into stripped,
optimised machine code. It is one layer: Electron's fuses and asar integrity, Windows code signing and online
activation on the portal are the others.

**Licence:** proprietary to Meroxis, all rights reserved ([LICENSE](LICENSE)). Unlike the rest of this repository it
is not under the AGPL and is not open source; it ships only in the official builds.

## What it does

| Function (JavaScript name) | |
|---|---|
| `verifyLicence(key)` | `QASA1.<payload>.<signature>` signed with an embedded licence key → the payload (JSON text), else `null`. The app still checks the payload's fields. |
| `verifyActivation(token, machine)` | `QACT1.<payload>.<signature>` from the portal, whose `machine` is this PC → the payload, else `null`. |
| `verifyEd25519(publicKey, message, signature)` | strict Ed25519 with a given key (tests, other keys). |
| `machineId(installId)` | Windows' `MachineGuid` + the installation's ID, SHA-256, 32 hex characters. |
| `seal(data, purpose)` / `open(sealed, purpose)` | HMAC-SHA256 seal tied to this PC, so editing the trial or clock state is detected. |
| `integrity(path)` | SHA-256 of a file (the running `app.asar`). |
| `verifyIntegrity(path, signature)` | whether `app.asar` is the file the official build signed (`resources/app.asar.sig`). |
| `publicKeys()`, `activationKeys()` | the embedded keys (a test keeps the licence keys equal to `license.ts`). |

Errors are never explained: a check passes or returns `null`/`false`.

## Keys (in `src/lib.rs`)

- `LICENCE_KEYS` — the same list as `LICENSE_PUBLIC_KEYS` in `packages/server/src/license.ts`. Add a key to both;
  `native-licence.test.ts` fails if they differ.
- `ACTIVATION_KEYS` — the portal's public key that signs activation tokens. When the portal gets a key of its own for
  activations, add its public half here and keep the old one until every installation has re-activated.
- `INTEGRITY_KEYS` — the build key that signs `app.asar`'s hash. **The check is off in 1.0:** `INTEGRITY_CHECK` in
  `apps/desktop/after-pack.cjs` is `false`, so no build is signed and nothing calls `verifyIntegrity`. Empty until
  Meroxis makes one:
  1. `node -e "const {generateKeyPairSync}=require('crypto');const k=generateKeyPairSync('ed25519');console.log(k.privateKey.export({type:'pkcs8',format:'pem'}));console.log(k.publicKey.export({format:'jwk'}).x)"`
  2. Put the PEM in the GitHub secret `QASA_INTEGRITY_KEY` (meroxis/qasa-erp → Settings → Secrets → Actions).
  3. Put the last line (base64url public key) in `INTEGRITY_KEYS`.
  `apps/desktop/after-pack.cjs` then writes `resources/app.asar.sig` in every official build. Without the secret,
  nothing is signed and `verifyIntegrity` is `false` — the app should treat that as "not configured", not as tampering,
  until the key is in place.

## Building

Needs Rust (https://rustup.rs; on Windows the MSVC toolchain, which GitHub's `windows-latest` runner has).

```
node native/licence/build.mjs      # cargo build --release, then dist/qasa_licence.node
npx vitest run packages/server/src/native-licence.test.ts
cargo test --release --manifest-path native/licence/Cargo.toml
```

`apps/desktop/build.mjs` copies `dist/qasa_licence.node` to `apps/desktop/native-out/`, and electron-builder puts it in
`resources/` (`extraResources`). The release workflow builds it before packaging and fails if it's missing.
The release profile strips symbols and uses LTO, `opt-level = 3`, `codegen-units = 1`, `panic = "abort"`.
