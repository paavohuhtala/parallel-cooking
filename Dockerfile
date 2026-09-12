# The server runs TypeScript directly via Node's type stripping, so there is no
# server build output — the runtime stage ships src/ alongside the built client.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Only `ws` and the hono packages survive --prod; the client's deps were
# already bundled into dist/ by the build stage. pnpm hardlinks out of its
# store into node_modules, so the store costs no extra bytes in this layer and
# there is no download cache left to clean.
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/main.ts"]
