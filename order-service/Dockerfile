FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy proto files (will be mounted via docker-compose)
RUN mkdir -p /app/protos

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Expose ports
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start service
CMD ["npm", "start"]
