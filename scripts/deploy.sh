#!/bin/bash
# scripts/deploy.sh

set -e

echo "🚀 Deploying RMRAS Backend..."

# Pull latest changes
echo "📦 Pulling latest changes..."
git pull origin main

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Run database migrations
echo "📊 Running database migrations..."
npx prisma migrate deploy

# Build the application
echo "🏗️ Building the application..."
npm run build

# Restart PM2
echo "🔄 Restarting PM2..."
pm2 restart rmras-backend || pm2 start ecosystem.config.js

# Reload Nginx
echo "🔄 Reloading Nginx..."
sudo systemctl reload nginx

echo "✅ Deployment completed successfully!"
