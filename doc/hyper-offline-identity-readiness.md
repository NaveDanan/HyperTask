# HyperTask: offline company identity and deployment readiness

Verified against repository files, the live mems01 settings endpoint, and primary upstream source on 2026-11-16. This is a deployment plan; it does not change the live service.

## Recommended target

Start with a Linux VM and Docker Compose, matching the existing mems01 deployment. Use the existing company Keycloak if available; otherwise add an internal Keycloak backed by Active Directory. Reuse an existing managed AD FS identity service through a tested federation/integration if that is IT's standard.

A fully isolated environment needs an internal identity provider. HyperTask's current Entra broker contacts login.microsoftonline.com, and its exchange sends provider azure. Cached Windows credentials or an old JWT do not replace reachable identity/discovery/signing-key/refresh services indefinitely. Internal Keycloak sign-in requires a desktop integration change, preferably an authorization-code browser flow with a correctly validated app return. Silent Windows SSO is an additional Kerberos/SPNEGO integration, not an automatic property of having a JWT.

## 1. What a company JWT does

- A trusted ID token identifies its subject. It is not a directory export or an administrator credential.
- GoTrue validates the configured provider, issuer, signature, allowed application audience, expiry and nonce requirements, then creates/links the account and issues its own session.
- The incoming token must be issued for the configured application. An Outlook/Graph access token or arbitrary JWT is not interchangeable with that ID token.
- The internal issuer's discovery and JWKS endpoints must be reachable by GoTrue. Browser OAuth also needs its authorization, token and userinfo endpoints.
- Keep GoTrue's own JWT signing secret shared only with the application services that validate its sessions. It is separate from the identity-provider client secret and signing keys.
- First successful company sign-in can create an account just in time. Importing every directory entry in advance requires a separate approved provisioning job.
- Account creation does not grant membership in a shared HyperTask workspace. Define an explicit workspace invitation/default-membership policy for authorized employees.
- Employee/group restrictions belong at a server/identity-provider enforcement boundary. Merely checking an email suffix or hiding desktop buttons is insufficient.
- Restrict alternative signup routes if the instance is company-only. The current live service allows email signup with automatic confirmation; enabling OIDC alone does not remove that route.
- Define deprovisioning and GoTrue session revocation. Disabling an AD account does not retroactively revoke every already issued downstream session.
- Existing @mention/People searches use Windows System.DirectoryServices against AD and fall back to Outlook GAL. Those searches are independent of JWT login and do not provision GoTrue users or workspace membership.

## 2. Verified GoTrue Keycloak configuration

The AppFlowy-IO/auth GitHub tag 0.8.0 resolves to commit 43770901225d5fb6d2a262e62412e1c223ffd85c, matching the auth revision intended by fetch-sources.sh. That source implements both the Keycloak browser provider and a Keycloak ID-token grant.

This establishes source capability, not a completed integration test of the deployed image. The live image is appflowyinc/gotrue:0.8.0 at digest c4a12b7adc41b0872604b9aec5af0649d576dd4d914468896048c88192e1ec0c; its health response has an empty version. Test the pinned deployment in staging before enabling company login.

Example environment for an internal Keycloak realm (placeholder hostnames):

```yaml
GOTRUE_EXTERNAL_KEYCLOAK_ENABLED: "true"
GOTRUE_EXTERNAL_KEYCLOAK_URL: "https://sso.company.internal/realms/company"
GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID: "hypertask-gotrue"
GOTRUE_EXTERNAL_KEYCLOAK_SECRET: "${HYPER_KEYCLOAK_CLIENT_SECRET}"
GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI: "https://tasks.company.internal/gotrue/callback"
GOTRUE_DISABLE_SIGNUP: "false"
```

The Keycloak URL is the realm URL, without /protocol/openid-connect/auth appended. The provider constructs its auth, token and userinfo URLs itself. Its OAuth validation requires client ID, secret and redirect URI. Store the confidential client secret only on the server.

Keycloak preparation:

1. Configure LDAP federation against internal AD over LDAPS, with an appropriately scoped bind account and corporate CA trust. Prefer read-only federation.
2. Map stable user identity plus name and email. Configure the AD account-state mapper and employee/group policy; disable self-registration if inappropriate.
3. Create the confidential OIDC client hypertask-gotrue with standard authorization-code flow and the exact callback above. Configure the required profile/email claims and an appropriate verified-email policy.
4. For directory visibility, Keycloak can synchronize all/changed LDAP users or import on demand. LDAP passwords are validated against LDAP, not imported.
5. Ensure desktop clients reach internal Keycloak over HTTPS, and GoTrue reaches discovery/JWKS and OAuth endpoints. The Compose backend network is internal:true, so an IdP outside that Docker network needs a deliberate internal-network route or network attachment.
6. Implement and test HyperTask's internal-provider sign-in path. The current Entra-only broker cannot be redirected to Keycloak by setting Tenant ID and Application ID.

For an existing ID-token integration, this source accepts POST /gotrue/token?grant_type=id_token with provider keycloak and id_token, subject to all token validation and nonce requirements. This is not permission to accept tokens with an arbitrary issuer/audience.

## 3. Current deployment is not ready to copy unchanged

The live mems01 stack uses appflowyinc upstream images and the existing appflowy database/service identifiers. Local deployment templates contain renamed upstream image names (hypertaskinc/...), APPFLOWY_* environment names changed to HYPERTASK_*, changed database identifiers, and renamed upstream Cargo build targets. Those references must be reconciled with the actual upstream images/source. Branding does not change an upstream image's configuration interface.

Preserve existing database names, roles, volume identities and object-storage contents when migrating. Fresh installation and migration require different initialization steps. Validate the final rendered Compose configuration without exposing secrets.

Other preparation:

- bootstrap.sh always runs docker compose pull. Provide an offline bootstrap that uses the preloaded/internal images and initializes the auth schema.
- The desktop build currently produces an unpacked Windows directory; it is not an installer. electron-builder.yml packages a debug Rust core and npm run build:desktop does not build that core. Produce, validate and preferably sign a release desktop package with a matching core before transfer.
- SMTP currently points at smtp-disabled. Email links, invitations and resets require an internal SMTP relay, or an explicitly designed alternative.
- Internal certificates must be trusted by desktops, GoTrue, Keycloak, and relevant container runtimes. Provide internal DNS and reliable NTP.
- External AI providers, Graph/Teams cloud endpoints, marketplace/theme downloads and other internet integrations need local replacements or clear unavailability. AD directory search can use the internal directory.

## 4. Offline deployment sequence

1. IT supplies a Linux VM, storage/backup capacity, internal application and SSO DNS names, corporate TLS chain, reachable internal AD/Keycloak, and optionally an SMTP relay. Pick the actual CPU architecture before building/mirroring images.
2. On a connected staging machine, fix and test a release manifest, pin every image/version, and build the desktop/core and optional web frontend. Do not fetch npm, Cargo, Go, OS packages or source code on the offline server.
3. Stage the complete image set: PostgreSQL/pgvector, Redis, SeaweedFS, GoTrue, cloud, admin, nginx, optional web, and Keycloak if not already provided. Mirror them into an internal registry. Include any Keycloak database and offline host/tool dependencies.
4. A Linux Docker VM may instead receive approved docker image save/load archives. Verify the exact offline Compose image references resolve after loading, including digest references. An internal registry is preferable for repeatable updates.
5. Supply secret values through the approved secret process. For an existing installation, take and test a consistent PostgreSQL plus object-storage backup and retain the relevant configuration/secrets. Preserve GoTrue signing/session configuration when continuity is intended.
6. Bootstrap locally, start only prebuilt images, and use docker compose up -d --no-build --pull never after the corrected manifest and schema initialization are ready.
7. With outside access blocked, verify company sign-in for two employees, rejection of an unauthorized identity, workspace membership, cross-client sync, attachments, restart persistence, session/deprovisioning behavior, backup restore, and SMTP if enabled. Verify desktop certificates and internal IdP callbacks.

K3s is a later option if its availability and storage operations are already managed. On MMEMS specifically, every image must first be pushed to artifactory.rafael.co.il/mems-docker-local-ww/danan/<image>:<unique-tag>, and workloads must pull with imagePullSecrets nave-pull-secret. Never import images directly into MMEMS nodes.

## Primary sources and local evidence

- [AppFlowy auth 0.8.0 tag mapping](https://api.github.com/repos/AppFlowy-IO/auth/git/ref/tags/0.8.0)
- [Pinned Keycloak provider: realm endpoints and OAuth configuration](https://github.com/AppFlowy-IO/auth/blob/43770901225d5fb6d2a262e62412e1c223ffd85c/internal/api/provider/keycloak.go)
- [Pinned configuration: OAuth client validation](https://github.com/AppFlowy-IO/auth/blob/43770901225d5fb6d2a262e62412e1c223ffd85c/internal/conf/configuration.go)
- [Pinned ID-token grant: Keycloak issuer/client audiences, validation and session issuance](https://github.com/AppFlowy-IO/auth/blob/43770901225d5fb6d2a262e62412e1c223ffd85c/internal/api/token_oidc.go)
- [Pinned external identity account creation and signup checks](https://github.com/AppFlowy-IO/auth/blob/43770901225d5fb6d2a262e62412e1c223ffd85c/internal/api/external.go)
- [Official Keycloak LDAP/AD federation documentation source](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/user-federation/ldap.adoc)
- [Official Keycloak Kerberos/SPNEGO documentation source](https://github.com/keycloak/keycloak/blob/main/docs/documentation/server_admin/topics/authentication/kerberos.adoc)
- [Official Docker image save reference](https://github.com/docker/cli/blob/master/docs/reference/commandline/image_save.md)
- [Official Docker Compose up options](https://github.com/docker/compose/blob/main/docs/reference/compose_up.md)
- Local evidence: deploy/self-hosted/compose.yaml, bootstrap.sh, Dockerfile.cloud, fetch-sources.sh; frontend/electron/electron-builder.yml; frontend/electron/src/main/HyperEntraBroker.ts and HyperOutlookScript.ts; frontend/electron/src/renderer/features/hyper-entra/HyperEntraFlow.ts; MMEMS image policy skill.
- Live read-only check on mems01: GoTrue Azure/Keycloak/SAML disabled; email enabled; signup enabled; mailer auto-confirm enabled. No live settings changed.
