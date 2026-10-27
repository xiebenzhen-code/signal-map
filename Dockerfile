FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm ci --registry="$NPM_REGISTRY"

COPY . .
RUN npm run api:build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist-api/server.mjs"]
