FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/brain-core-entrypoint
RUN mkdir -p /app/uploads && chown -R node:node /app && chmod 755 /usr/local/bin/brain-core-entrypoint

EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/brain-core-entrypoint"]
CMD ["node", "dist/index.js"]
