FROM node:22-alpine AS builder
# better-sqlite3 requires native build tools
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
COPY packages/motor-channels/package.json packages/motor-channels/
RUN npm ci --workspace=@ascendimacy/motor-channels
COPY tsconfig.base.json ./
COPY packages/motor-channels packages/motor-channels/
RUN npm run build --workspace=@ascendimacy/motor-channels

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copy built JS and node_modules (includes prebuilt .node binaries)
COPY --from=builder /app/packages/motor-channels/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
RUN mkdir -p /data/session /data/db /data/cards
VOLUME ["/data"]
# stdio MCP transport — run with: docker run -i motor-channels
# HTTP transport planned for V0.2; EXPOSE reserved
CMD ["node", "dist/main.js"]
