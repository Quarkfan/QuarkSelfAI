FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/bridge-compat/package.json ./packages/bridge-compat/package.json
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.22.0-bookworm-slim AS runtime
ARG LARK_CLI_VERSION=1.0.88
ARG PNPM_VERSION=11.7.0
ENV NODE_ENV=production
RUN npm install --global "@larksuite/cli@${LARK_CLI_VERSION}" \
    && npm cache clean --force

# DSH has a large peer/optional dependency graph that npm 11's arborist does
# not resolve reliably in this workspace. Keep its exact closure isolated and
# locked with the package manager version used by the DSH project itself.
WORKDIR /opt/dsh-runtime
COPY deploy/dsh-runtime/package.json deploy/dsh-runtime/pnpm-lock.yaml deploy/dsh-runtime/pnpm-workspace.yaml ./
RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && pnpm install --prod --frozen-lockfile --ignore-scripts

ENV DSH_EXECUTABLE="/opt/dsh-runtime/node_modules/.bin/dsh" \
    DSH_HOME="/app/var/dsh" \
    DSH_PROFILE="feishu-assistant"

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/bridge-compat/package.json ./packages/bridge-compat/package.json
RUN npm ci --omit=dev \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY packages/bridge-compat ./packages/bridge-compat
COPY config ./config
COPY compat ./compat
COPY cordis.patch.yml ./cordis.patch.yml
COPY migrations ./migrations
COPY web ./web
COPY deploy/container-entrypoint.sh /usr/local/bin/quark-self-ai-entrypoint
RUN mkdir -p /app/var && chown -R node:node /app
USER node
EXPOSE 3210
VOLUME ["/app/var"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3210/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/quark-self-ai-entrypoint"]
