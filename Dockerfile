FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production
RUN npm install -g pm2

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Create storage directory
RUN mkdir -p storage/uploads storage/screenshots storage/recordings

EXPOSE 3000

CMD ["pm2-runtime", "ecosystem.config.js"]
