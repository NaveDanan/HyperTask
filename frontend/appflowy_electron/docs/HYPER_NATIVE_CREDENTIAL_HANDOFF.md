# HyperTask native credential handoff

Upstream reference: OpenBot f8af37ab73e96784f174a11104505a965e722cab, Copyright (c) 2026 CopilotKit, MIT. Existing attribution and licenses remain intact.

`server/src/agents/routes.ts` POST `/api/agents/:agentId/callback-token` requires `requireUser` and returns `{ token }`, status 201. Repeating POST rotates the token. DELETE returns 204. Both store operations use `findAccessibleProfile` and `requireManageable` inside a locked transaction. The server remains the authorization authority. Native main adds owner authentication, service readiness, main-frame validation and explicit native confirmation before either mutation.

The generic renderer POST refusal remains in place. New `window.appflowy.hyperOpenBot.callbackKey({ action, agentId })` accepts only `create | rotate | revoke` and an ASCII identifier of 1 through 100 letters, digits, underscores or hyphens. IPC channel is `hyper-openbot:callback-key`. The result has only `{ status }`, with `issued | revoked | cancelled | refused | failed`. Creation and rotation use the same upstream POST. No headers, response bodies or transport errors are returned. A byte-bounded one-time key response is displayed in a main-owned native dialog. Copy key writes the OS clipboard only after that explicit native choice and another owner/session check; Done and invalidated sessions do not copy. No file export or renderer credential state is used. A failure after mutation can mean the key was rotated without delivery; refresh and rotate again rather than assuming the mutation failed.

Native identity is revalidated across asynchronous boundaries. Session invalidation, renderer destruction or navigation cancels the action and dismisses native dialogs. The flow has a five-minute deadline. The preload publishes the existing application API only when `process.isMainFrame` is true. No CSP, nodeIntegration, transport, session partition, backend owner binding or smoke safeguard changes are made.

## Renderer specialist receiver

Subscribe during renderer startup with:

```ts
const unsubscribe = window.appflowy.hyperOpenBot.onNativeDestination(destination => {
  // destination.kind === 'connections'
  // destination.confirmation === 'native-confirmed'
  // Route to the Connections list and reload authoritative state.
});
```

The typed payload is `HyperNativeDestination` in `src/shared/api.ts`; the event channel is `hyper-openbot:native-destination`. Its optional `serverId` is reserved for an independently validated future destination; this implementation never supplies one. Do not interpret the event as connection success. The separate renderer destination specialist owns routing and subscription placement. No owned renderer navigation files were changed here.

Pinned `app/src/components/desktop/desktop-return.tsx` confirms brokered connection in the browser and then emits only `openbot://open`, even when browser confirmation fails. It contains no app ID, server ID or credential exchange. Main accepts that exact credential-free shape, consumes other OpenBot URIs without renderer delivery and rejects query, fragment, path, authority, encoding and size variants. Known native connection callback names under the existing AppFlowy scheme are also consumed. Ordinary AppFlowy login and invitation links retain their existing handling. Cold launch, second-instance and open-url ingress use main classification. Navigation requires explicit native confirmation with a current owner lease. No protocol association is added or changed; delivery requires an existing handler or future explicit opt-in registration.

## Validation boundary

All transport and dialogs in tests are synthetic. No Electron app launch, operating-system association registration, real credential store, account login or live backend was used. Native dialog behavior on the installed OS and browser consent completion require a later authorized end-to-end exercise. This implements native key delivery, not a stub handler; renderer destination subscription remains the specialist's integration task.

Validation completed: TypeScript checks passed; full suite passed with 137 files, 1034 tests and 5 skipped tests; final focused native/session regressions passed with 46 tests. Production build passed with existing bundle and dynamic-import warnings. `git diff --check` passed. The full suite preceded the final additional URI authority classification and closed-action type check; focused tests and typecheck were rerun after those changes.
