# Deploy the frontend and room

The frontend is static. The room requires a continuously running Node process that supports WebSocket upgrades; it is not suitable for a short-lived serverless function. Nothing has been published to a production service by this task.

## Existing Cloudflare frontend

The PWA and sharing metadata require the complete build output, including `sw.js`,
`manifest.webmanifest`, `icons/`, `brand/` and offline recovery files. Preserve `_headers`;
custom Worker proxy responses must apply equivalent headers. See [PWA hosting and checks](PWA.md).
The build-only `SITE_URL` defaults to the supplied expected `https://camposworlds.click` origin.
Verify the public domain, HTML, image and room after publishing; a local build cannot establish
that the live domain has been updated. Do not use `VITE_QA=1` for a public release.

Build with `npm ci && npm run build` and publish `dist/` through the existing Worker Static Assets deployment. Keep the deployment's existing `VITE_WS_URL` setting. No room-server settings need to change for the mobile rendering update. Do not set `VITE_QA=1` on the public build.

Vite copies `public/_headers` into `dist/_headers`. Cloudflare Workers Static Assets [reads that file](https://developers.cloudflare.com/workers/static-assets/headers/) to apply the one-day asset cache. Runtime URLs include a content-derived asset revision; HTML is revalidated so a new release loads new bundles. Deploy the entire `dist/` directory, including `_headers`, rather than just `index.html`. Custom Worker responses need equivalent headers in that Worker if they bypass static asset serving.

After deployment verify the mobile layout and the asset response's `Cache-Control` header. See [mobile measurements and the physical-phone checklist](MOBILE-PERFORMANCE.md). A Git push only updates the live site automatically if the existing Cloudflare project is connected to that branch.

## Accounts, clubs and events (Supabase)

These features are optional. Without configuration the app builds and runs guest-only, and the interface says accounts are not set up. To enable them, follow [ACCOUNTS.md](ACCOUNTS.md) to create a Supabase project and apply `supabase/migrations/`. Then:

1. **Cloudflare frontend build:** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the build environment, next to the existing `VITE_WS_URL`, which stays as it is. Both are public values. Rebuild and deploy `dist/` as before.
2. **Room server (Render or your existing host):** add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as secret environment variables, and optionally `SUPABASE_ANON_KEY`. Keep `ALLOWED_ORIGINS`, `ROOM_INVITE`, `ADMIN_TOKEN` and `ROOM_CAPACITY` unchanged. Restart the room.
3. **Supabase Auth:** set the Site URL and redirect URLs to the frontend origin, so confirmation emails return players to the campus.
4. **Verify:** sign up, create a profile, open the campus in a second browser and check that your @handle appears in the People panel, then create a club and an event and RSVP.

The room calls Supabase over HTTPS with a 5-second timeout. If Supabase is unreachable, signed-in players continue as guests and are told why; nobody is disconnected.

## Campus store (Bachs)

Optional, and only with accounts. Follow [STORE.md](STORE.md):

1. Apply `supabase/migrations/20261022120000_campus_store.sql`.
2. In Bachs, add a webhook endpoint at `https://<room host>/shop/webhook` for `collection.succeeded` and `checkout.completed`. If a proxy fronts the room, route `/shop/webhook` to it as well as `/ws`. Keep `/admin/kick` private as before.
3. On the room server, set `BACHS_SECRET_KEY`, `BACHS_WEBHOOK_SECRET` and `PUBLIC_APP_URL` as secrets. Optionally set `SHOP_PRICE_CHARACTER` / `SHOP_PRICE_ITEM` in naira. Restart the room.
4. The frontend needs no new settings. `shop-return.html` is part of the build.

## Same-origin deployment (recommended for a private demo)

1. Run `npm ci && npm run build` in CI with Node 22.12+.
2. Serve `dist/` over HTTPS with immutable caching for hashed assets. Return `index.html` for frontend routes and a real 404 for missing assets. Apply the security and cache headers in `public/_headers` through your server configuration; Nginx does not read that file.
3. Run `npm run server` as a supervised process. Set `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3001`, `ALLOWED_ORIGINS=https://worlds.example.edu`, a room invitation for a private demonstration, and a random server-only `ADMIN_TOKEN` of at least 32 characters. Run `npm run verify:production-config` in that environment first.
4. Proxy `/ws` to that process, preserving the origin and WebSocket upgrade headers. Keep all `/admin/*` private to the operator. Persist `server/data/` for moderation, reports and lab storage. Route `/ready` and `/health` directly to the room for monitoring. See [the operations runbook](OPERATIONS.md).
5. Confirm two independent browsers can join, chat, leave, reconnect, and receive useful feedback for an incorrect invitation. Test using the public HTTPS origin, not localhost.

Example Nginx configuration, with the actual domain and TLS configured by the operator:

```nginx
location / {
    root /srv/campos-worlds/dist;
    try_files $uri $uri/ /index.html;
}
location ^~ /assets/ {
    root /srv/campos-worlds/dist;
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, immutable";
}
location = /sw.js {
    root /srv/campos-worlds/dist;
    try_files $uri =404;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Service-Worker-Allowed "/";
}
location = /manifest.webmanifest {
    root /srv/campos-worlds/dist;
    try_files $uri =404;
    default_type application/manifest+json;
    add_header Cache-Control "no-cache";
}
location ~* \.(?:js|css|png|svg|jpg|jpeg|webp|woff2?|glb|ktx2|hdr|wasm|ogg|mp3|wav)$ {
    root /srv/campos-worlds/dist;
    try_files $uri =404;
}
# Campus store payment events from Bachs (only if the store is set up; docs/STORE.md).
location = /shop/webhook {
    proxy_pass http://127.0.0.1:3001;
}
location /ws {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 45s;
}
location = /ready {
    proxy_pass http://127.0.0.1:3001;
}
location = /health {
    proxy_pass http://127.0.0.1:3001;
}
```

## Separate frontend and room domains

Build with `VITE_WS_URL=wss://room.example.edu/ws`, host the `dist/` files on a static host, and set `ALLOWED_ORIGINS` on the room server to the exact frontend HTTPS origin. `VITE_` variables are public build configuration, not secrets. Configure TLS and WebSocket proxying at the room host. The current single room must route all participants to the same process; blindly adding load-balanced replicas produces separate populations.

## Docker room

```sh
docker build -f server/Dockerfile -t campos-worlds-room .
docker run --rm -p 3001:3001 \
  --env-file /secure/path/campos-room.env \
  -e ALLOWED_ORIGINS=https://worlds.example.edu \
  -e ROOM_INVITE=your-private-demo-invitation \
  -v campos-reports:/app/server/data campos-worlds-room
```

The image enforces production configuration, including an admin token. The env file must
be private and contain the real server settings; use the platform secret manager where
available. Protect the container behind HTTPS and network controls; an origin check is
not authentication. A repeatable image/restart exercise is `node tests/container-release.mjs`
after building the `campos-worlds-room:release` image. The test uses disposable data and
does not deploy production.

## Scaling boundary

Live room state is in memory, with no cross-process presence or matchmaking. Optional accounts
and community records use Supabase; the economic lab has its own persistent file store.
The 48-player ceiling is exercised by `npm run test:capacity`; its actual measured result
and environment are in the release evidence. A successful local exercise does not establish
worldwide capacity. Production should use a measured admission limit on its real hardware.
Durable session/account moderation is implemented; staffed report handling, verified Core
identity and institution partitioning still need operator/product decisions. Cross-region
rollout also needs latency-aware room placement and matchmaking.

Keep institution records and production credentials out of the frontend. Store transactions,
account records and reports require the server-side access controls described above.
