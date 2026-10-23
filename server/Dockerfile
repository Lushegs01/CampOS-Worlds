# syntax=docker/dockerfile:1
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --ignore-scripts --strict-ssl=true
COPY server ./server
COPY shared ./shared
# Checkouts made with a private umask can contain 0600 files/0700 directories.
# Keep source root-owned, but make it readable by the non-root runtime on every host.
RUN chmod -R a+rX /app/server /app/shared \
    && chmod a+r /app/package.json /app/package-lock.json \
    && mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/ready',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","server/index.mjs"]
