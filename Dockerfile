# Frontend — Next.js standalone build
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN NODE_OPTIONS="--max-old-space-size=4096" npm ci --omit=optional

COPY . .

# Make API URLs configurable at build time (Next.js bakes NEXT_PUBLIC_* vars)
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_SIMULATOR_URL=http://localhost:8001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SIMULATOR_URL=$NEXT_PUBLIC_SIMULATOR_URL

RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
