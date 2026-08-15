FROM node:22-bookworm-slim AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml ./
COPY packages/browser-kit/package.json packages/browser-kit/package.json
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY server server
RUN pnpm --filter browser-kit build && pnpm --filter @browser-kit/server build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=10000

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/browser-kit/package.json packages/browser-kit/package.json
COPY server/package.json server/package.json
COPY --from=build /app/packages/browser-kit/dist packages/browser-kit/dist
COPY --from=build /app/server/dist server/dist
RUN pnpm install --prod --frozen-lockfile

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
