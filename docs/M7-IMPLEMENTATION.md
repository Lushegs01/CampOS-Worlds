# SIG Sauer M7 in Combat Arena

The M7 is a **free, level-one primary battle rifle**, available to guests and signed-in players. This follows the final request to make it free, superseding the original premium-only brief. Vanguard, Wasp and M7 are the three free firearms. The other nine premium firearms retain their existing verified-payment ownership checks. There is no M7 store item, checkout or ownership grant.

## Play

Open **Combat Arena → Edit loadouts → Battle rifle → SIG Sauer M7 → Equip**. The Armory also offers an interactive preview and the full balance statistics. Signed-in loadouts save to the account; guests save to the current device. Existing saved loadouts are preserved.

- **B** switches between automatic and semi-automatic. A controller's D-pad down also switches modes.
- **I** inspects the weapon. Firing, aiming, reloading, sprinting or swapping interrupts inspection immediately.
- On touch devices, the dedicated **fire selector** and **inspection** buttons appear while holding the M7. Their position, visibility and size can be changed in the existing HUD editor, independently of the weapon information panel. They retain at least 44 px targets.
- The fixed configuration includes a suppressor, hollow magnified optic housing, transparent coated lenses, illuminated aiming point and actual **2× ADS zoom**. Earned weapon finishes work through the existing progression system.

There is no attachment-selection architecture in this repository. This implementation therefore ships a working fixed suppressed/optic configuration. It does not offer cosmetic buttons for nonexistent red-dot, muzzle or XM157 ballistics features. The folding stock is represented visually; there is no gameplay folding action.

## Balance and authority

All values below are game balance, not claims about real-world performance.

| Attribute | M7 |
| --- | --- |
| Fire modes | Auto / semi; 600 rpm maximum in either mode |
| Magazine / reserve | 20 / 80 |
| Damage | 36 before 32 m; 32 from 32 m; 27 from 65 m |
| Maximum ray distance | 170 m |
| Head / leg multiplier | 1.5 / 0.86 |
| Thin-cover penetration | 55% retained damage under the existing cover rules |
| Reload | 2.75 s tactical / 3.25 s empty |
| ADS | 20 simulation ticks, approximately 0.33 s |
| Movement | 91% of base; 48% while aiming |
| Recoil | 0.017 rad vertical kick per shot; stronger than the starting rifle |

Three body hits at close range take 200 ms under ideal conditions; the Wasp retains its close-range cadence advantage. Stronger recoil, bloom, smaller capacity, slower handling and reloads limit sustained fire. Semi-auto releases recoil/bloom recovery between controlled shots. There is no separate armour system in this game; penetration uses the existing authoritative thin-cover mechanic.

The client sends buttons and aim commands. The shared simulation selects the firing mode and enforces trigger reset, cadence, ammunition, reloads, recoil and movement on both the server and the predicting client. Hits, damage, eliminations and progression remain server-authoritative. Mode is included in reconciliation snapshots and is retained independently per weapon slot; inspection has its own cancellable phase. Existing weapon indices remain 0–12; M7 is appended at index 13. New button bits and two appended snapshot fields require the web client and room server to ship together.

## Artwork, sound and performance

Original artwork is reproducibly built with:

```sh
node scripts/assets/build-m7.mjs
```

The model includes bevelled receiver profiles, raised machining details, open M-LOK cuts, rail teeth, short barrel and suppressor, magazine with floorplate and ribs, trigger guard/trigger, grip, folding hinge/telescoping stock, controls and charging handles, optic mount, rings, turrets and transparent lenses. `body`, `mag` and `bolt` are separate animation parts; the first-person IK hands follow the grip, handguard and magazine. The charging handles do not reciprocate on firing.

| Asset | Triangles | Download |
| --- | ---: | ---: |
| First-person / Armory GLB | 8,488 | 192,464 bytes |
| Third-person LOD GLB | 2,568 | 98,128 bytes |

Both use meshopt geometry and shared 256px Basis/KTX2 colour, normal and roughness maps. Metre-scaled texture coordinates keep machining grain consistent across large receiver surfaces. The third-person LOD retains the suppressor, optic, magazine and stock silhouette on LOW. The M7 is excluded from startup weapon preloads: it streams only for inspection, the player's equipped weapon or a visible remote carrying it. The ordinary free starter LODs still preload. Shared model resources stay in the existing asset cache; instance-owned reticle GPU resources are disposed when switching weapons or closing the preview.

`src/arena/m7Audio.ts` contains original **synthesized sound design**, not licensed recordings or a reused generic rifle profile. The suppressed report combines transient, pressure/body, gas, action and decay layers. The same per-shot report works for semi and automatic fire. Release, removal, insertion, action, ready, switching, dry fire and inspection have distinct mechanical samples. The complete bank occupies less than 300 KB decoded mono PCM at 48 kHz and is generated/cached only in the active audio context after lazy loading its separate module. Up to eight M7 shot voices play concurrently; positional attenuation, the player's sound settings and indoor reverb use the existing mixer. Suppressed muzzle flashes and lights are reduced.

Reload Foley uses `shared/arena/m7-presentation.mjs`: release at 14%, removal at 34%, insertion at 68%, action at 80%, ready at 96% of the actual reload timer. Cues are emitted as the visible animation crosses each point, with monotonically tracked progress to avoid replay after reconciliation. Switching cancels further reload cues. No delayed generic reload recording is scheduled.

### Reference and rights

No proprietary game model, manufacturer CAD, photograph texture or third-party audio is redistributed. These are original project assets based on public configuration references:

- [Army equipment guide, XM7 description and visual, page 14](https://api.army.mil/e2/c/downloads/2025/06/03/167e7d2f/army-equipment-for-festival.pdf): piston operation, ambidextrous controls, non-reciprocating side handle, folding/collapsible stock, M-LOK handguard and suppressed configuration.
- [SIG Sauer defense catalogue](https://www.sigsauer.com/media/sigsauer/resources/FULL_DEFENSE_CAT_26_PRINT.pdf): MCX SPEAR / M7 configuration.
- [Army ammunition overview](https://asc.army.mil/web/news-lighten-up/): military hybrid metal cases. The UI identifies 6.8×51mm hybrid-case **military** ammunition, without equating all commercial .277 SIG FURY loadings with it.

The optic is a conventional game magnified sight; no fire-control/rangefinding capability is claimed. The artwork is an optimized interpretation, not a dimensionally certified manufacturer asset. Aesthetic approval and listening on physical mobile speakers/headphones remain human review; browser emulation cannot establish real-device audio quality or thermal performance.

## Rollout

Apply `supabase/migrations/20261112120000_arena_m7.sql` to the deployment database, then release the client and room server together. The migration adds the free catalogue row without changing existing loadouts, statistics, purchases or progression. The existing loadout RPC and server validator enforce its catalogue entry. No payment-provider configuration is required for the M7.

## Verification

Validated on 12 November 2026:

| Check | Result |
| --- | --- |
| Production TypeScript + Vite + PWA build | Pass |
| Complete automated Node suite | **299 passed, 0 failed** |
| Full browser workflow | **8 checks passed**, no unexpected page errors |
| Multiplayer persistence | M7: **12 shots, 2 kills** recorded in PostgreSQL |
| Mobile guest flow | Free equip, selector, firing and reload passed |
| Additional presentation workflow | 4 checks passed, including ADS; [results](m7-presentation-results.json) |

Run:

```sh
npm run build
npm test
node tests/browser-m7.mjs
```

`tests/arena-m7.test.mjs` checks free/unsold access, stable indices, balance, trigger reset, automatic cadence, selector-spam rate limits, mode snapshot reconciliation, per-slot mode retention, reload completion/cancellation, inspection interruption, deterministic prediction replay, auto-fire trigger reset, GLB decoding, moving parts, texture compression, LOD/download budgets, and cached unclipped distinct audio samples.

`tests/browser-m7.mjs` runs against Chromium, a real local PostgreSQL database, the local Supabase stand-in, and the room server. It verifies account-backed free equip/save without any ownership fixture; on-demand Armory assets; two-player M7 representations and authoritative mode/ammunition state; reloading and inspection; multiplayer eliminations and saved M7 weapon statistics; and a guest using mobile fire-selector/fire/reload controls. Server-side test positioning is used to make sightlines deterministic; weapon state, hits and damage are not injected.

See [machine-readable browser results](m7-browser-results.json) and the captured images:

1. [First-person view](screenshots/m7/first-person.png)
2. [Third-person player holding M7](screenshots/m7/third-person.png)
3. [Armory inspection](screenshots/m7/armory.png)
4. [Loadout selection](screenshots/m7/loadout.png)
5. [Reload](screenshots/m7/reload.png)
6. [In-match inspection](screenshots/m7/inspect.png)
7. [Mobile controls](screenshots/m7/mobile.png)
8. [ADS sight picture](screenshots/m7/ads.png)

The automated browser uses SwiftShader software WebGL and LOW settings. Its frame rate is not a mobile hardware benchmark. The production build retains the repository's existing large Three.js chunk warning.
