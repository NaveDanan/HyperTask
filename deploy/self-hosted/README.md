# Company sign-in preparation

These settings prepare GoTrue for HyperTask's Windows Entra sign-in. This change does not deploy or restart any service.

IT must register a dedicated company application, enable public client/native authentication, grant openid/profile/email consent, and register the desktop redirect URI:

`ms-appx-web://Microsoft.AAD.BrokerPlugin/<client-id>`

Set the same Tenant ID and Application (client) ID in **Settings → Storage & server → Company sign-in (Microsoft Entra ID)**. Both are empty by default. Sign-out suppresses automatic sign-in on this install; the company sign-in button remains available. Only one automatic attempt is made per launch. Cancel discards pending broker and server results.

## Server environment

- `HYPER_ENTRA_ENABLED=true` enables Azure; its default is false.
- `HYPER_ENTRA_CLIENT_ID` is the dedicated application ID (the ID-token audience).
- `HYPER_ENTRA_TENANT_ID` is the company directory ID. Compose builds `https://login.microsoftonline.com/<tenant>/v2.0`.
- `HYPER_ENTRA_CLIENT_SECRET` supplies a secret only on the server when its OAuth provider validation/browser flow requires one. Never put it in the desktop app.
- `HYPER_ENTRA_REDIRECT_URI` is the server OAuth callback URL (normally `https://<server>/gotrue/callback`), distinct from the desktop broker URI.

Keep `GOTRUE_JWT_AUD=authenticated`. This is the issued GoTrue session audience, not the incoming Entra token audience.

## ID-token grant behavior and limits

The locally provided GoTrue source copies (`frontend/electron/.cache/hyper-people/token_oidc.go`, `azure.go`) show that `provider: azure` requires Azure enabled and an allowed Client ID. It discovers the issuer from the Azure token, verifies its OIDC signature/expiry, and checks its audience against the configured client IDs. The grant itself does not use a client secret or OAuth redirect URI. Provider startup validation/browser OAuth may still require those values; verify against the exact built GoTrue version before enabling it.

The provided ID-token grant detects the Azure issuer from the token; the Azure URL alone does **not** enforce a tenant allowlist on that grant. Use a single-tenant app registration. HyperTask additionally checks the broker's returned tenant and audience against its configured IDs before exchanging the token. Do not rely on desktop validation alone as a server authorization boundary.

GoTrue expects SHA256(raw nonce) to match the ID-token nonce. HyperTask requests that hash from WAM and sends the preimage only if the returned claim matches; nonce-free cached tokens omit nonce. Unverifiable cached nonces fail with a readable fallback. Tokens are held only during sign-in; the existing Rust OAuth callback persists the resulting GoTrue session as it does for other sign-in methods.

No server source was fetched from or changed on mems01 in this task. The supplied source copies are evidence of grant behavior, not proof that a deployed binary has the same implementation.
