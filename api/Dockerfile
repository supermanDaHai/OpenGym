# node:22-slim (glibc) — better-sqlite3 ships prebuilt binaries for glibc targets.
# The old alpine base (musl) has no prebuilds and would need a full C++ toolchain.
FROM node:22-slim
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources && apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm config set registry https://registry.npmmirror.com
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js db.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
