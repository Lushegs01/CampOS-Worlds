# CampOS Core boundary

## Repository inspected

Inspected the user's `Lushegs01/CampOS-Core` repository at commit **d0ec54b109ea68629b830d7e8749610d64624277** (2026-08-26) on 2026-10-12. A read-only local reference checkout was used; no Core files were changed, and its code/dependencies are not included in the Worlds bundle.

Verified sources:

- `src/app/api/modules/sso/route.ts`
- `src/app/api/modules/sso/exchange/route.ts`
- `src/lib/modules/sso-code.ts`
- `src/lib/modules/sso.ts`
- `src/app/sso/launch/route.ts`
- `docs/architecture/module-launch-identity.md`
- `README.md`, “External module registration and SSO”

Repository: https://github.com/Lushegs01/CampOS-Core/tree/d0ec54b109ea68629b830d7e8749610d64624277

## Verified existing contract

Core's launcher is `GET /api/modules/sso?module=<name>&institution=<workspace-slug>&context=<student|lecturer|admin>`. Core validates identity, membership, enabled modules, roles and launch scopes. Where a receiver has a configured start flow, Core can redirect to it so the receiver first establishes state. `/sso/launch` delegates to the launcher.

The browser receives a cryptographically random 43-character base64url authorization code. It is valid for **300 seconds**, is bound to the module, and is consumed atomically by Redis `GETDEL`. A module backend exchanges `{code,module}` through `POST /api/modules/sso/exchange`. Core then issues a **60-second HS256 JWT**, issuer `campos-core`, audience equal to the module name, unique `jti`, and identity/tenant/selected-scope claims. The JWT is not put in browser URLs.

Receivers must validate issuer, audience, algorithm, expiry and replay protections using the exact server-side per-module secret. The Core JWT session secret is not shared with receivers. The signed `launchRole`, `launchContext` and `launchScope` govern the selected identity; do not choose the most privileged entry in the broad `roles` array. Match the receiver's state cookie and nonce, constrain redirects, and mint a separate secure HttpOnly Worlds session.

## What this application implements

`src/config/services.ts` declares a typed `ServiceAdapter`, plus an honest `demo` adapter. ScanMark, UniReg, Clearr, NADA and Haloft each open a functional explanation. No endpoint is contacted and no account linkage is implied. The UI renders no fabricated balance, clearance, course record or attendance transaction.

The existing verified SSO conventions cover external module launch. They do **not** establish that Worlds or Haloft are already registered recipients. We do not claim that they are. Clearr's finance capabilities remain within Core unless an approved external receiver is actually configured.

## Production integration work

1. Register Worlds as its own approved receiver through Core's actual module configuration and institution entitlement process. Confirm the chosen module identifier and per-module secret with the operator.
2. Add a separate Worlds backend session layer. Implement the receiver's start/callback and server-to-server exchange using the verified contract and nonce validation. Re-check any contract changes since the inspected commit.
3. Store only a public display-name/avatar projection for room presence. Keep identifiers, email, matriculation, roles, tokens and records exclusively in the authorized backend session.
4. Derive room institution and feature flags server-side from verified claims and current entitlements. Do not take an institution ID or role from a room packet as authority.
5. Implement an authenticated service-launch adapter that uses verified Core launch options and exact approved origins. Open protected services in their own authorized module flow. No browser secret, reused password, arbitrary redirect, or invented API is needed.
6. Keep Worlds rewards separate from academic and financial databases. Any attendance action must occur in the actual authorized ScanMark workflow, not because an avatar approached a lecture hall.

No environment variable currently enables production Core integration. This is intentional: enabling an unimplemented security contract through configuration would misrepresent readiness.
