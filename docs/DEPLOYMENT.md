# Deploy the frontend and room

The frontend is static. The room requires a continuously running Node process that supports WebSocket upgrades; it is not suitable for a short-lived serverless function. Nothing has been published to a production service by this task.

## Existing Cloudflare frontend

Build with `npm ci && npm run build` and publish `dist/` through the existing Worker Static Assets deployment. Keep the deployment's existing `VITE_WS_URL` setting. No room-server settings need to change for the mobile rendering update. Do not set `VITE_QA=1` on the public build.

Vite copies `public/_headers` into `dist/_headers`. Cloudflare Workers Static Assets [reads that file](https://developers.cloudflare.com/workers/static-assets/headers/) to apply the one-day asset cache. Runtime URLs include a content-derived asset revision; HTML is revalidated so a new release loads new bundles. Deploy the entire `dist/` directory, including `_headers`, rather than just `index.html`. Custom Worker responses need equivalent headers in that Worker if they bypass static asset serving.

After deployment verify the mobile layout and the asset response's `Cache-Control` header. See [mobile measurements and the physical-phone checklist](MOBILE-PERFORMANCE.md). A Git push only updates the live site automatically if the existing Cloudflare project is connected to that branch.

## Same-origin deployment (recommended for a private demo)

1. Run `npm ci && npm run build` in CI with Node 22.12+.
2. Serve `dist/` over HTTPS with immutable caching for hashed assets. Return `index.html` for frontend routes.
3. Run `npm run server` as a supervised process. Set `HOST=127.0.0.1`, `PORT=3001`, `ALLOWED_ORIGINS=https://worlds.example.edu`, a room invitation for a private demonstration, and a strong server-only `ADMIN_TOKEN` if moderation removal is enabled.
4. Proxy `/ws` to that process, preserving the origin and WebSocket upgrade headers. Keep `/admin/kick` private to the operator (not through the public frontend proxy). Persist `server/data/` if retaining reports across restarts.
5. Confirm two independent browsers can join, chat, leave, reconnect, and receive useful feedback for an incorrect invitation. Test using the public HTTPS origin, not localhost.

Example Nginx configuration, with the actual domain and TLS configured by the operator:

```nginx
location / {
    root /srv/campos-worlds/dist;
    try_files $uri $uri/ /index.html;
}
location /assets/ {
    root /srv/campos-worlds/dist;
    expires 1y;
    add_header Cache-Control "public, immutable";
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
```

## Separate frontend and room domains

Build with `VITE_WS_URL=wss://room.example.edu/ws`, host the `dist/` files on a static host, and set `ALLOWED_ORIGINS` on the room server to the exact frontend HTTPS origin. `VITE_` variables are public build configuration, not secrets. Configure TLS and WebSocket proxying at the room host. The current single room must route all participants to the same process; blindly adding load-balanced replicas produces separate populations.

## Docker room

```sh
docker build -f server/Dockerfile -t campos-worlds-room .
docker run --rm -p 3001:3001 \
  -e ALLOWED_ORIGINS=https://worlds.example.edu \
  -e ROOM_INVITE=your-private-demo-invitation \
  -v campos-reports:/app/server/data campos-worlds-room
```

The container recipe is provided but not executed in this environment. Use your deployment platform's secret store for the admin token and invitation. Protect the container behind HTTPS and network controls; an origin check is not authentication.

## Scaling boundary

The room is in memory, with no cross-process state, durable identity, shared persistence or matchmaking. The default 24-player cap is a safeguard, not a load-test result. For a pilot, add verified Core identity, institution partitioning, durable moderation, telemetry, operational report handling and measured load tests before increasing room size. Cross-region rollout also needs latency-aware room placement and more complete prediction/reconciliation.

The app has no institution records, financial data or production credentials. Preserve that separation when introducing live services.
