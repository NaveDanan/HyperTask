# HyperTask development JWT login

This is an explicit development login helper. It does not configure GoTrue to accept arbitrary bearer tokens on its public API.

## Run

From frontend/electron:

```powershell
npm run dev:jwt
```

This uses an unsigned sample JWT for dev-jwt@hypertask.test. To use another compact JWT:

```powershell
npm run dev:jwt -- --jwt-file C:\path\to\development.jwt
```

The token file must contain only the JWT. Put it outside source control. The helper deliberately ignores the input token's signature, issuer, audience and expiry. It needs an email claim, a preferred_username that is an email, or a subject; subject-only tokens receive a stable synthetic development email. Input role/admin claims are not forwarded.

The launcher defaults to SSH agent@MMEMS-mems01 and ~/appflowy-self-host. Alternatives:

```powershell
npm run dev:jwt -- --host user@development-host --remote-dir ~/development-deployment --jwt-file C:\path\to\development.jwt
```

The dev server must explicitly opt in once:

```powershell
npm run dev:jwt -- --enable-server
```

The current mems01 development deployment was opted in and tested on 2026-11-16. The opt-in file is .hyper-dev-jwt-enabled in the deployment directory and is bound to SERVER_ORIGIN. Removing that file disables further development exchanges. The helper currently supports the HTTP development stack; it connects only to its loopback auth endpoint.

## How it works

1. The launcher passes the JWT through authenticated SSH standard input. Tokens are not command-line arguments and are not printed.
2. The helper reads the development deployment's signing secret only on the server. It validates the explicit deployment opt-in and extracts only development identity fields.
3. Through http://127.0.0.1:<HTTP_PORT>/gotrue, it uses the admin generate-link API and consumes the verification link without sending email. It verifies the returned account using /gotrue/user.
4. It returns a real GoTrue access/refresh session through SSH. The normal GoTrue and cloud APIs continue validating their own tokens.
5. Electron starts with a separate user-data and support profile under frontend/electron/.cache/hyper-dev-jwt. The session handoff waits for successful native core initialization, checks the exact server origin, is consumed once and removes the temporary handoff file.
6. A visible DEV JWT indicator identifies the running development mode. The gate requires explicit opt-in, an unpackaged app and a loopback development renderer. Packaged and normal preview launches do not consume these sessions.

SSH access is required because the helper can impersonate regular identities on this opted-in development server. It exposes no network login-bypass service and does not change the live GoTrue image or normal auth configuration. Generated GoTrue users and remote development workspaces remain ordinary server records. Existing account permissions are still applied by the server.

To return to normal development, close the isolated window and run npm run dev -- --watch. Do not copy the development opt-in file, token files or generated session files into a production deployment.

## Newsletter comparison

Read-only checks of the running Newsletter endpoints through mems01 on 2026-11-16 showed:

- app-config.js: SSO_AUTO_LOGIN true, SSO_PROVIDER oidc.
- /api/collections/users/auth-methods: oauth2.enabled false, providers [].
- A fabricated unsigned JWT sent to the live users/auth-refresh endpoint was rejected with HTTP 401: valid record authorization token required.
- The current Newsletter implementation uses provider authorization-code login with PKCE, authenticates the provider's user-info response and then uses a PocketBase session.
- Its automatic-registration hook grants new authenticated provider users role viewer and featuredWriter false. It does not grant privileges from browser/JWT role claims.
- Accepting every authenticated provider user is not accepting an arbitrary JWT. Newsletter API authentication still requires a valid PocketBase auth token.

Evidence: D:/Projects/Newsletter/docs/oidc-login.md, src/lib/auth/sso.ts, pb_hooks/auth.pb.js, scripts/sync-pocketbase-oidc-settings.mjs, and the live endpoints above. Cluster resources were not changed.

## Verification

- node --test deploy/self-hosted/HyperDevJwtExchange.test.mjs
- npm exec vitest -- run src/main/HyperDevJwtBootstrap.test.ts src/main/HyperBrowserReturnStartup.test.ts
- Live exchanges against the opted-in mems01 development server accepted an unsigned token and a token with an invalid signature, foreign issuer and expired exp. Incoming privilege claims were ignored; the result was a fresh real GoTrue session.
- An isolated Electron development launch displayed the Development JWT user account and visible development indicator, with no runtime panic or unexpected core exit.
- Production build and typecheck passed. The full suite: 1,834 tests passed (8 skipped).

The launcher watches main/preload changes by default. Use --no-watch for a smoke run that must remain stable while other source changes are being made. HYPER_DEV_JWT_PROFILE_DIR can select another isolated test-profile directory.
