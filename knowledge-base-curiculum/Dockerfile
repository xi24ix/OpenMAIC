FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY src ./src
COPY database ./database

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build

RUN mkdir -p /app/data
ENV NODE_ENV=production
ENV KB_HOST=0.0.0.0
ENV KB_PORT=3000
ENV KB_DATA_DIR=/app/data
ENV KB_ASSET_ROOT=/app/data

VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=7200s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz',{headers:{authorization:'Bearer '+process.env.KB_API_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/cli.js", "serve"]
