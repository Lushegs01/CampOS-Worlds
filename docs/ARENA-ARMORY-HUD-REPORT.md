# Combat Arena: HUD customization, Armory, auto-fire and mobile performance — engineering report

Date: 2026-11-10. Scope: the existing Combat Arena (`src/arena`, `server/arena`, `shared/arena`) and the existing
campus store (`server/shop.mjs`, Bachs). Details for players and operators are in
[COMBAT-ARENA.md](COMBAT-ARENA.md) and [STORE.md](STORE.md).

## 0. Audit: what existed, and what was reused

| Area | Found | How this work uses it |
|---|---|---|
| Rendering | React Three Fiber + three.js, licensed PBR asset pack (KTX2/Basis, meshopt glTF), three profiles, post stack | Unchanged art; adaptive resolution and device recommendation added; weapon LODs now on demand |
| Weapons | One shared catalogue (`shared/arena/weapons.mjs`) used by server simulation, client prediction and the DB catalogue | Extended with Armory access, role and trade-off; no second catalogue |
| Settings | `useArena.settings` in localStorage | Same store, now validated (`shared/arena/settings.mjs`) and synchronised to the account |
| Input | One `controls` object for keyboard/mouse, gamepad, touch | Auto-fire adds the FIRE bit in the same 60 Hz tick; touch controls read the layout |
| Accounts | Supabase auth; room verifies tokens; `account_snapshot` | Same identity; ownership comes from `account_snapshot.owned` |
| Database | Supabase migrations with RLS and security-definer functions | One additive migration |
| Multiplayer | Authoritative `/arena` WebSocket, prediction/reconciliation, lag compensation, interest management | Unchanged protocol; new `owned` request and `owned`/`loadoutReset` events |
| Payments | Bachs hosted checkout, signed webhooks, idempotent fulfilment, `shop_ownership` | Weapons are store items on the same pipeline; refunds/reversals added |
| Assets | `scripts/assets/build-arena.mjs` from Objaverse (Hugging Face) and Poly Haven | Not re-run: those hosts are blocked from this build environment (see limitations) |

## 1. Features implemented

- **HUD Customization Studio** (`src/arena/HudEditor.tsx`, model in `shared/arena/hud.mjs`): drag, resize, hide, fade,
  align every HUD element and every touch control on a live preview drawn with the match's own components; crosshair
  style, colour, thickness, outline and size; HUD opacity, text size, icon size, button transparency, high contrast;
  presets Classic FPS, Competitive, Minimal, Mobile Standard, Mobile Claw (any edit → Custom); separate desktop,
  touch-landscape and touch-portrait layouts chosen automatically on rotation; selection outlines, drag and resize
  handles, alignment guides, snap to grid, undo/redo (buttons and Ctrl+Z / Ctrl+Y), keyboard nudging, reset
  element, reset layout, restore previous, save, return to game, overlap warnings; drafts kept on the device until
  saved or discarded; firing range (Training with no bots) to try a layout. The live HUD and touch controls are
  rendered from the layout (`src/arena/Hud.tsx`, `src/arena/Touch.tsx`, `src/arena/hudViews.tsx`).
- **Armory** (`src/arena/Armory.tsx`): exactly two free firearms (Vanguard AR-7 assault rifle, Wasp SMG-9), nine
  premium firearms, each with its licensed model, LOD, sound profile, recoil pattern and statistics; inspection of
  the real 3D model (downloaded only when inspected); role, trade-off, damage by range, fire rate, handling, range,
  recoil, magazine, reload and time-to-eliminate; ownership state, price, purchase, purchase history.
- **Secure purchases**: Bachs checkout through the existing store; server-side entitlements checked by the arena
  server and the database; refunds by verified webhook (configurable event names) or operator endpoint; duplicate
  and late events cannot grant twice or re-grant after a refund; legacy grants so nobody loses a weapon they used.
- **Auto-fire** (`shared/arena/autofire.mjs`, `src/arena/net.ts`): OFF by default; ON/OFF in settings with the
  required explanation, F key, AUTO touch button, pause menu; fires only while the player's own aim is on a
  visible enemy with line of sight, within range, weapon ready; never aims, never compensates recoil, never reloads;
  public per-playlist policy.
- **Performance**: device-capability recommendation (`src/arena/device.ts`), adaptive resolution then profile
  (`shared/arena/adaptive.mjs`), on-demand third-person weapon models, lazy Armory/studio chunks, campus bundle kept
  flat.
- **Balance fix**: Halcyon BR-3 no longer eliminates with one body-shot burst (found by the new fairness test).

## 2. Files changed

New: `shared/arena/hud.mjs`, `shared/arena/autofire.mjs`, `shared/arena/settings.mjs`, `shared/arena/adaptive.mjs`,
`src/arena/HudEditor.tsx`, `src/arena/Armory.tsx`, `src/arena/hudLayout.ts`, `src/arena/hudViews.tsx`,
`src/arena/device.ts`, `supabase/migrations/20261110120000_arena_armory_and_preferences.sql`,
`tests/arena-hud.test.mjs`, `tests/arena-autofire.test.mjs`, `tests/arena-armory.test.mjs`,
`tests/arena-armory-accounts.test.mjs`, `tests/arena-performance.test.mjs`, `tests/browser-arena-hud.mjs`.

Changed: `shared/arena/weapons.mjs`, `shared/arena/rules.mjs`, `shared/shop.mjs`, `server/arena/service.mjs`,
`server/arena/match.mjs`, `server/shop.mjs`, `server/room.mjs`, `server/accounts.mjs`, `server/index.mjs`,
`src/arena/{ArenaApp,Hud,Touch,Loadout,Lobby,Scene,store,net,input,arena.css}`, `src/arena/scene/soldiers.ts`,
`src/account/shop.ts`, `src/services/community.ts`, `tests/{arena-sim,arena-match,arena-accounts,shop,shop-accounts}.test.mjs`,
`tests/browser-arena.mjs`, `.github/workflows/quality.yml`, `.env.example`, `docs/{COMBAT-ARENA,STORE,DEPLOYMENT}.md`.

## 3. Database migration

`20261110120000_arena_armory_and_preferences.sql` (additive; existing rows untouched except the catalogue flag):
`shop_items.kind` gains `weapon` and nine weapon items; `shop_ownership.source` (`purchase` / `legacy`);
`shop_orders` status `refunded` + `refunded_at`; new `shop_revocations`; `arena_catalog.premium` (premium weapons
unlock level 1); `arena_weapon_owned()`; legacy ownership rows; `shop_fulfil` replaced (refunded orders never
re-granted); `shop_revoke()`; `my_purchases()`; `save_arena_loadout` replaced (ownership check); new
`arena_preferences` table with RLS, `my_arena_preferences()`, `save_arena_preferences()` (shape and 48 KB size
checks). Applied and exercised on real PostgreSQL 17 by the account suites.

## 4. Purchase and entitlement architecture

```text
Armory "Buy" ──campus WS──▶ room: shopCheckout ─▶ shop_create_order (amount = server price) ─▶ Bachs checkout (Idempotency-Key = order)
Bachs ──signed webhook──▶ /shop/webhook: HMAC check ─▶ shop_fulfil (event once, amount/currency checked, grant once)
                                         └▶ granted(account,item) ─▶ campus clients (shopGranted) + arena.granted ─▶ arena clients ('owned')
Equip ──arena WS──▶ validateLoadout(…, owned from account_snapshot) ── refused unless owned
Save  ──Supabase──▶ save_arena_loadout ── refused unless arena_weapon_owned
Refund ─ verified webhook (BACHS_REFUND_EVENTS) or POST /admin/shop/revoke ─▶ shop_revoke ─▶ revoked(account,item) ─▶ free loadout from next deployment
```

The client never declares ownership; returning from checkout grants nothing; no simulated payments exist; card
details never touch this system (Bachs hosted checkout). No randomised paid rewards.

## 5. HUD customization

See section 1 and [COMBAT-ARENA.md › HUD customization](COMBAT-ARENA.md#hud-customization). Storage: localStorage
(`campos-arena-hud`, drafts in `campos-arena-hud-draft`), and for signed-in players `arena_preferences.hud`
(newest wins on connect; debounced writes). Every read is validated; repaired parts are reported in the studio.

## 6. Auto-fire behaviour

See [COMBAT-ARENA.md › Auto-fire](COMBAT-ARENA.md#auto-fire). Verified in unit tests against the real simulation
(fire rate, magazine, reload, recoil, teammates, walls, range, target loss) and in Chromium against a Training bot
through the real server (it fired while aimed at the bot, which the server eliminated, and stopped when the aim
left).

## 7. Mobile performance measurements

**No GPU or physical phone was available in this environment.** Every browser run used software rendering
(SwiftShader), which draws the arena at about 3 fps whatever the profile; those numbers say nothing about real
devices, and the 30 fps (phone) / 60 fps (desktop) targets remain **unverified on hardware**. What was measured:

| Measure | Before | After |
|---|---|---|
| Third-person weapon models downloaded before a match can be played | all 13 LODs, 2.59 MB | free weapons + knife, 0.65 MB (others on demand; idle prefetch only on Medium/High without data saver) |
| Campus main bundle (gzip) | 111.50 KB | 111.92 KB |
| Arena code downloaded when the arena opens (gzip) | ArenaApp 39.7 + Scene 26.1 KB | ArenaApp 52.4 + Scene 24.2 + shared weapons 3.2 KB |
| Armory / HUD studio code | — | 4.5 / 6.8 KB gzip, only when opened |
| Arena chunks in the offline precache | none | none |

Rendering cost per profile is unchanged from the measurements in COMBAT-ARENA.md (Low ≈ 70 draw calls / 214k
triangles). Adaptive performance is covered by unit tests (step-down order, floor, recovery, no oscillation), not
by device measurements. Server load is unchanged (auto-fire is client-side and sends ordinary commands).

## 8. Automated test results

| Suite | Result |
|---|---|
| `npm test` (all unit and integration suites, including real PostgreSQL) | **293 / 293 pass** (baseline before this work: 268 / 268) |
| `node tests/browser-arena.mjs` (existing arena browser suite, updated for the Armory) | **12 / 12 checks pass** |
| `node tests/browser-arena-hud.mjs` (new: studio desktop + phone, persistence, repair, firing range, auto-fire) | **9 / 9 checks pass** |
| `npm run build` (TypeScript check + production bundle + service worker) | **succeeds** |

Defects found and fixed during this work by the new tests: touch buttons overlapping on 667×375 phones (touch
controls now scale with the screen with a 40 px floor); Halcyon BR-3 one-burst eliminations; edge-anchored HUD
elements wrapping word by word; the studio's selection box not following an element's size; the studio preview
hidden behind its own panel; the kill feed overlapping the timer in Mobile Standard; the arena silently dropping
rate-limited loadout requests (now answered).

## 9. Known remaining limitations

- **Not measured on real hardware** (no GPU, no phones here): frame rates, memory growth over long sessions,
  battery and thermal behaviour are unverified. The adaptive renderer is the safeguard, not a measurement.
- **Tactical carbine and bullpup classes have no weapon**: their licensed models could not be downloaded (the asset
  hosts were blocked). They were left out rather than filled with duplicated or placeholder models.
- **Refund webhooks are off by default**: Bachs refund event names could not be confirmed here; set
  `BACHS_REFUND_EVENTS` after checking, or use `POST /admin/shop/revoke`.
- **A real sandbox purchase against Bachs** (rather than the stand-in API used in tests) still has to be run with
  your Bachs account, as STORE.md's checklist says.
- **Auto-fire cannot be verified by the server** (no browser game can tell an auto-fired trigger from a manual
  one); it is safe because it only presses the same button and the server validates every shot. A ranked playlist
  that forbids it would rely on the client honouring the published policy.
- **Legacy grants** give existing players the premium weapons they had already used; this is deliberate so the
  update takes nothing away, and is visible in their purchase history as "kept from before the Armory".
- **The HUD studio's alignment guides** snap to centres/edges and other elements' anchor points, not to every edge
  of every element.
- No known critical or high-severity defects remain in the tested paths.

## 10. Production build status

`npm run build` succeeds (TypeScript `tsc -b` clean, Vite production bundle, service worker with 37 precached
entries, arena chunks excluded from the offline cache).
