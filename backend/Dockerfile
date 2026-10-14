# Production Dockerfile for ReachInbox Backend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and backend package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY backend/prisma ./backend/prisma/

# Install dependencies and generate Prisma client
RUN npm install
RUN cd backend && npx prisma generate

# Copy backend source
COPY backend/ ./backend/

# Build backend TypeScript
RUN cd backend && npm run build

# Runner stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copy built artifacts and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/package*.json ./backend/

EXPOSE 4000

WORKDIR /app/backend

CMD ["node", "dist/index.js"]
