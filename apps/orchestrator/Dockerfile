# The orchestrator. Build from the repository root:
#   docker build -f apps/orchestrator/Dockerfile .
#
# Node 24 runs the TypeScript sources directly (type stripping), so there is no
# build step and what runs is exactly what is in the repository.

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

# Every workspace manifest, so the lockfile stays in sync, but only the
# orchestrator's dependencies are installed. The Cloudflare tunnel is an
# optional dependency for laptops; a deployed server has its own public URL.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/web/package.json apps/web/
COPY eval/spike/package.json eval/spike/
RUN npm ci --omit=dev --omit=optional --workspace=@one-moment/orchestrator --include-workspace-root=false

COPY packages/core/src packages/core/src
COPY apps/orchestrator/src apps/orchestrator/src
# The recorded caller and pharmacist voices for "Play the recorded call".
COPY eval/fixtures/caller-pause-6s.wav eval/fixtures/caller-choice-6s.wav eval/fixtures/pharmacist-hello-24k.wav eval/fixtures/pharmacist-thanks-24k.wav eval/fixtures/

EXPOSE 8787
CMD ["node", "apps/orchestrator/src/server.ts"]
