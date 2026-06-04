# Render Docker Deployment for QuickBoom Backend
FROM node:22-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git python3 make g++

# Copy package files first for better caching
COPY package*.json ./

# Clean npm cache and install dependencies
RUN npm cache clean --force
RUN npm ci --legacy-peer-deps --ignore-scripts

# Copy prisma schema
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port (Render sets PORT env var automatically)
EXPOSE 10000

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
