FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY shared ./shared
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node
ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node","server/index.mjs"]
