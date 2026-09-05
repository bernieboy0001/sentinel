# SENTINEL agent worker image (render/railway/fly/docker)
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --include-workspace-root --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build -w packages/agent

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/.data
ENV PORT=8787
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/agent/dist ./packages/agent/dist
COPY --from=build /app/packages/agent/package.json ./packages/agent/package.json
RUN mkdir -p /app/.data
# deployed.json contains only public testnet addresses - commit it to git
# after running `npm run deploy:testnet` (see DEPLOY.md step 1).
COPY --from=build /app/packages/agent/deployed.json /app/.data/deployed.json
EXPOSE 8787
CMD ["node", "packages/agent/dist/index.js"]
