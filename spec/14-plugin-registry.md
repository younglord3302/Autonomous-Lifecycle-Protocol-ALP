# ALP Specification — Plugin Registry Protocol

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

While plugins can be imported via direct URLs (e.g., `!import: "https://example.com/plugin.alp"`), the **Plugin Registry Protocol** provides a standardized way to discover, host, and import plugins using semantic aliases (e.g., `!import: "@alp/scrum@1.0.0"`).

An ALP Registry is an HTTP service (or static file host) that conforms to a specific directory structure and REST interface, allowing parsers to fetch plugin metadata, resolve versions, and download plugin files.

---

## 2. The Registry Alias Syntax

The `!import` directive supports resolving plugins via a registry alias.

**Syntax:**
```alp
!import: "@<namespace>/<plugin-name>@<version-range>"
```

**Examples:**
```alp
!import: "@alp/scrum@1.0.0"       // Exact version
!import: "@alp/kanban@^2.1.0"     // Semver range
!import: "@internal/deploy@latest" // Latest tag
```

### 2.1 Resolution Flow

When a parser encounters a registry alias:
1. It determines the registry base URL (from `.alprc` configuration or falling back to the default `https://registry.alp-protocol.org`).
2. It fetches the plugin metadata from `<base_url>/-/<namespace>/<plugin-name>/meta.json`.
3. It resolves the requested `<version-range>` against the available versions in the metadata.
4. It fetches the actual `.alp` file using the URL provided in the metadata for the resolved version.
5. It caches the file locally in `.alp/.cache/registry/`.

---

## 3. Registry API Protocol

A valid ALP registry MUST implement the following HTTP GET endpoints. A registry CAN be implemented as a purely static file server if the files are generated ahead of time.

### 3.1 Plugin Metadata Endpoint

**GET** `/-/<namespace>/<plugin-name>/meta.json`

Returns metadata about the plugin, including all available versions and tags.

**Response (200 OK):**
```json
{
  "name": "@alp/scrum",
  "description": "Standard Scrum object types for ALP",
  "author": "ALP Core Team",
  "tags": {
    "latest": "1.2.0",
    "beta": "2.0.0-beta.1"
  },
  "versions": {
    "1.0.0": {
      "url": "https://registry.alp-protocol.org/@alp/scrum/1.0.0/plugin.alp",
      "integrity": "sha256:abc123def456...",
      "dependencies": {}
    },
    "1.1.0": {
      "url": "https://registry.alp-protocol.org/@alp/scrum/1.1.0/plugin.alp",
      "integrity": "sha256:fed789cba012...",
      "dependencies": {}
    },
    "1.2.0": {
      "url": "https://registry.alp-protocol.org/@alp/scrum/1.2.0/plugin.alp",
      "integrity": "sha256:111222333444...",
      "dependencies": {
        "@alp/core-types": "^1.0.0"
      }
    }
  }
}
```

**Rules:**
- `tags` MUST map strings to valid semver versions present in the `versions` object.
- `url` in the version object MAY be relative (e.g., `/download/@alp/scrum/1.0.0/plugin.alp`) or absolute.
- `integrity` is OPTIONAL but RECOMMENDED. If present, the parser MUST verify the downloaded file against this hash.

### 3.2 Plugin File Endpoint

**GET** `<url_from_metadata>`

Returns the raw `.alp` file for the requested version.

**Response (200 OK):**
```
Content-Type: text/plain; charset=utf-8
```
*(The raw ALP file content)*

---

## 4. Parser Configuration (`.alprc`)

Projects or developers can configure registry behaviors using an `.alprc` (or `.alprc.json`) file located in the workspace root or the user's home directory.

**Example `.alprc`:**
```json
{
  "registries": {
    "default": "https://registry.alp-protocol.org",
    "@internal": "https://alp-registry.internal.company.com"
  },
  "auth": {
    "https://alp-registry.internal.company.com": {
      "token": "${ALP_INTERNAL_TOKEN}"
    }
  }
}
```

### 4.1 Namespace Routing

If a plugin alias has a namespace (e.g., `@internal/deploy`), the parser checks if a specific registry URL is mapped to that namespace in `.alprc`.
If a mapping exists, the parser uses that registry. Otherwise, it falls back to the `default` registry.

### 4.2 Authentication

Private registries require authentication. The `.alprc` file can provide a `token` (which may reference an environment variable). When communicating with an authenticated registry, the parser MUST include the token in the `Authorization` header:
```
Authorization: Bearer <token>
```

**Per-namespace tokens (registry hardening).** A registry host MAY gate
individual namespaces. A single global token protects every namespace; a
`namespace=token` map protects only the listed namespaces (their reads and
downloads require the matching bearer token), while unlisted namespaces remain
public. A global token additionally protects the marketplace listing/search
endpoint.

**Publish-time auth.** Publishing is a `PUT /-/<namespace>/<plugin-name>`
request carrying the manifest and file contents inline. It MUST be gated by the
target namespace's token; the server MUST reject publish requests that omit the
token, present a wrong token, attempt path traversal outside the version
directory, or declare a namespace that differs from the URL namespace. This
prevents unauthenticated clients from injecting packages into any namespace.

### 4.3 Signature Trust Roots (`.alprc` `trustedKeys`)

Tokens prove *who may publish*; signatures (§4.2, v4.2) prove *what was
published was not tampered with*. A consumer configures a **trust root** so
installs are verified automatically without passing a key each time.

The `.alprc` `trustedKeys` field maps a namespace (`@ns`) or `*` (global) to a
trust anchor, which is either:

- an **inline PEM public key** — the package signature's signer key MUST equal it exactly; or
- a **fingerprint** (`alp1…`, the SHA-256 of the PEM public key) — the package signature's embedded signer key MUST hash to it.

```json
{
  "trustedKeys": {
    "@demo": "alp1c0593b2f97ec8a92fa05e5bb",
    "*": "-----BEGIN PUBLIC KEY-----\nMCow…\n-----END PUBLIC KEY-----"
  }
}
```

> **Note:** on the command line, omit the leading `@` when naming a namespace
> (`alp keys trust add demo <fp>`); commander interprets a leading `@` as a
> file-argument and would drop it. The config key is still written as `@demo`.

Rules:
- An `@ns` entry takes precedence over `*`.
- When a trust root is configured for a namespace, an install of a **signed** package MUST verify its signature against that root; a signature from an untrusted key MUST be rejected.
- When a trust root is configured for a namespace, an **unsigned** package for that namespace MUST be rejected.
- Packages in namespaces with **no** trust root install as before (signing remains optional and backward compatible).
- The CLI manages trust roots via `alp keys trust add <ns|*> <fingerprint|file>` and `alp keys trust list`; the Python SDK resolves them through `RegistryClient.resolve_trust_entry` / `is_trusted`.
- **Server-side enforcement (v4.4).** A hosted registry (`alp serve --registry`) whose `.alprc` declares a trust root for a namespace MUST reject `PUT` uploads that are unsigned or signed by an untrusted key for that namespace. This closes the loop so a compromised token cannot publish untrusted packages into a protected namespace. `alp registry verify <name>[@version]` audits a stored version's signature against the local trust roots without installing.

---

## 5. Security & Verification

1. **HTTPS Required:** All registry communication MUST occur over HTTPS. Parsers MUST reject plain HTTP connections.
2. **Strict Integrity:** When resolving via a registry, if the metadata provides an `integrity` hash, the parser MUST verify the downloaded file against it. If it fails, parsing MUST halt with a fatal error.
3. **No Redirects for Metadata:** Parsers SHOULD NOT follow HTTP redirects (301/302) when fetching `meta.json` to prevent hijacking, unless explicitly configured to trust the redirect source.

---

## 6. Dependency Resolution Strategy

Plugins can depend on other plugins (see [11-plugins.md](11-plugins.md)). The registry protocol relies on a **Strict Singleton** resolution strategy.

1. The parser collects all direct plugin imports from the project.
2. It fetches metadata for all imported plugins to discover their transitive dependencies.
3. If two plugins depend on the same namespace/name, their version requirements are intersected.
4. If the intersection is empty (e.g., `^1.0.0` and `^2.0.0`), the parser MUST produce a fatal **Version Conflict Error**.
5. Only ONE version of a plugin can exist in the final resolution graph.

This ensures that custom block markers (like `@epic`) have a single, unambiguous `@type_definition` in the project.
