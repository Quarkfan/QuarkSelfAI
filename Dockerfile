FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22.22.0-bookworm-slim AS runtime
ARG LARK_CLI_VERSION=1.0.88
ENV NODE_ENV=production
WORKDIR /app
RUN npm install --global "@larksuite/cli@${LARK_CLI_VERSION}" \
    && npm cache clean --force
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config ./config
COPY migrations ./migrations
COPY web ./web
RUN mkdir -p /app/var && chown -R node:node /app
USER node
EXPOSE 3210
VOLUME ["/app/var"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3210/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/app.js"]
