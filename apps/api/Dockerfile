# Build from the repository root:  docker build -f apps/api/Dockerfile -t dnki-api .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @dnki/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @dnki/api build && pnpm --filter @dnki/api deploy --prod --legacy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
