FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY server ./server
COPY public ./public

# Create volume mount point for the database
RUN mkdir -p /data

ENV F1_CACHE_DB=/data/f1cache.db
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
