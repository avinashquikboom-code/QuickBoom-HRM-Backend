# Render Docker Deployment for Quickboom Backend
FROM node:20-alpine

WORKDIR /app

# Copy prisma schema FIRST (postinstall in package.json runs prisma generate)
COPY prisma ./prisma/

# Install dependencies (postinstall will auto-run prisma generate now)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Expose port (Render sets PORT env var automatically)
EXPOSE 10000

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
