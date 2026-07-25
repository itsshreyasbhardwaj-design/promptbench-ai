# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security vulnerability.

Report it through
[GitHub's private advisory form](https://github.com/itsshreyasbhardwaj-design/promptbench-ai/security/advisories/new).
Include the affected version or commit, reproduction steps, and the impact as
you see it.

You can expect an acknowledgement within a few days and an assessment within two
weeks. If the report is valid, we will agree a disclosure timeline with you and
credit you in the release notes unless you prefer otherwise.

## Scope

In scope:

- Authentication and session handling
- Workspace isolation and permission enforcement
- API key generation, storage and verification
- Input validation on API routes
- Injection through prompt templates or dataset content
- Secret exposure in responses, logs or client bundles

Out of scope:

- Vulnerabilities in an unmodified third-party dependency — report those upstream
- Missing rate limits on a deployment that has configured them permissively
- Anything requiring physical access to the host
- Reports generated solely by an automated scanner with no demonstrated impact

## Security model

Worth understanding before reporting:

- **Local mode is not an auth bypass.** When `CLERK_SECRET_KEY` is absent the
  app uses a single local identity, and this is deliberate for self-hosted and
  development use. Setting the key enforces real multi-tenant auth. A deployment
  that exposes local mode to the internet has misconfigured itself; that is not
  a vulnerability in the software.
- **API keys are stored as SHA-256 hashes.** Plaintext is shown once and never
  persisted. SHA-256 rather than a slow KDF is intentional: these are 256-bit
  random secrets, not user-chosen passwords, so there is no dictionary to
  attack and a KDF would only add per-request cost.
- **Tenant scoping is structural.** Every repository read takes `workspaceId` as
  its first argument. A cross-tenant read would require bypassing that
  signature, and any path that does is a genuine finding — please report it.
- **Prompt templates do not have a runtime.** Substitution is single-pass and
  values are inserted literally, so a dataset value containing `{{x}}` is text,
  not an expansion. Any input that achieves recursive expansion or code
  execution is a genuine finding.

## Supported versions

Pre-1.0, only the latest `main` receives security fixes.
