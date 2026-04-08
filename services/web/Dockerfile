# syntax=docker/dockerfile:1.7

# --- deps ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars are baked into the client bundle at build time, not
# read at runtime. Pass via --build-arg in CI / Cloud Build. The default
# is the local docker-compose URL so the existing dev workflow keeps working.
ARG NEXT_PUBLIC_GATEWAY_WS_URL=ws://localhost:8080/ws/session
ENV NEXT_PUBLIC_GATEWAY_WS_URL=$NEXT_PUBLIC_GATEWAY_WS_URL
RUN npm run build

# --- runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Next.js standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
