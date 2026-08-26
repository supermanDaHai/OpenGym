# node:22-slim (glibc) — better-sqlite3 ships prebuilt binaries for glibc targets.
# The old alpine base (musl) has no prebuilds and would need a full C++ toolchain.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js db.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
