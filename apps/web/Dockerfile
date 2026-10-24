# Build from the repository root:  docker build -f apps/web/Dockerfile -t dnki-web .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @dnki/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @dnki/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo/apps/web
COPY --from=build /repo /repo
USER node
EXPOSE 3000
# API_INTERNAL_URL must point at the API service (private network address).
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--port", "3000"]
