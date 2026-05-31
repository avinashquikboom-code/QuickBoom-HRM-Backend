# Render Docker Deployment for Quickboom Backend
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (for layer caching)
# We need all deps (including dev) because Prisma CLI is used at build & runtime
COPY package*.json ./
RUN npm ci

# Copy prisma schema for generate + migrate
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source and build
COPY . .
RUN npm run build

# Expose port (Render sets PORT env var automatically)
EXPOSE 10000

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
