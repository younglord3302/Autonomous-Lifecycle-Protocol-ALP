# ALP Specification — Encrypted Secrets Vault

**Version:** 8.4.0
**Status:** Stable

---

## 1. Overview

ALP v8.4.0 adds an encrypted secrets **vault** so agents can store and
retrieve sensitive values (API keys, tokens, connection strings) without
committing plaintext to `.alp/`. The vault is encrypted with an
X25519 recipient key (age-style) and the symmetric payload is sealed with
AES-256-GCM. A `keyring` of trusted recipient public keys doubles as the
registry trust root (spec/14 §4.2), so the same mechanism that signs
packages also gates secret access.

The vault is:
- **At rest encrypted** — `.alp/.vault/store.jsonl` holds only ciphertext + nonce.
- **Recipient-scoped** — each secret is sealed to one or more X25519 recipients.
- **Auditable** — every `get`/`set`/`rotate` is logged to `.alp/.vault/audit.jsonl`.

---

## 2. The `@vault` Object (optional metadata)

A workspace MAY declare a `@vault` object describing recipients and policy:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | No | Vault identifier (default `default`) |
| `recipients` | String[] | Yes | X25519 public-key PEM fingerprints allowed to unseal |
| `rotation_days` | Int | No | Auto-rotate reminder window (default 90) |

The actual ciphertext lives in `.alp/.vault/store.jsonl`, never in `.alp` files.

---

## 3. Vault Engine

### 3.1 Envelope

```
SealedSecret = {
  id:        string,
  recipients: { fingerprint: base64(encapsulated_key) }[],  # per-recipient AEAD key
  nonce:     base64(12 bytes),
  ciphertext: base64(AES-256-GCM(secret)),
  created_at: ISO timestamp,
  rotated_at: ISO timestamp | null,
}
```

For each recipient, an ephemeral X25519 keypair wraps a random 256-bit
data key (age `scrypt`/`x25519` envelope). The data key encrypts the secret
with AES-256-GCM.

### 3.2 API

| Method | Description |
|---|---|
| `vault.set(id, plaintext, recipients)` | Seal and persist a secret |
| `vault.get(id, private_key)` | Unseal a secret for a recipient |
| `vault.list(recipient?)` | List secret ids (no values) |
| `vault.rotate(id, private_key)` | Re-seal under a fresh data key |
| `vault.audit()` | Return the audit trail |

### 3.3 Keyring as trust root

The `recipients` of a `@vault` ARE the registry trust root (spec/14 §4.2).
`alp registry publish --sign-key <pem>` reuses the same fingerprints, so a
maintainer who can publish signed packages can also unseal the vault.

---

## 4. CLI

```
alp vault set <id> --value <secret> --recipient <pem>
alp vault get <id> --key <private-pem>
alp vault list
alp vault rotate <id> --key <private-pem>
alp vault audit
```

> Encryption in the Python SDK requires the optional `cryptography` package
> (`pip install alp-sdk[vault]`). Without it, `Vault` raises `RuntimeError`,
> mirroring the optional signing dependency (spec/08 signing). The TS SDK uses
> Node's built-in `crypto`, so encryption is always available there.

---

## 5. Example

```alp
!alp-version: 8.4.0

@vault
  id: default
  recipients:
    - "age1qlp...frontend-maintainer"
    - "age1z9x...backend-maintainer"
  rotation_days: 90
```

```typescript
import { Vault } from '@alp/parser';
const vault = new Vault({ dir: '.alp/.vault' });
await vault.set('db-password', 's3cr3t', [
  'age1qlp...frontend-maintainer',
]);
const secret = await vault.get('db-password', frontendPrivateKey);
```
