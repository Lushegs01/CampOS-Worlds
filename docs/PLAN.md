# CampOS Worlds implementation

1. Build a compact, locally modelled tropical campus and a cinematic entry screen.
2. Add third-person movement, shared collision geometry, camera obstruction handling and accessible controls.
3. Add a customizable procedural avatar, a five-stop tour, collectible quest, repeatable basketball game and persisted profile.
4. Add a bounded WebSocket room, validated movement and proximity requests, chat, emotes, muting, reports and operator removal.
5. Inspect CampOS Core; keep demo service adapters separate from identity and protected records.
6. Build, test actual browser rendering and two clients, inspect screenshots, and document measured results and deployment.

The initial build is a local application, with a deployable static frontend and separately hosted Node room server. No production CampOS connection is assumed.
