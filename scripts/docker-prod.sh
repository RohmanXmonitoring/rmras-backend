#!/bin/bash
# scripts/docker-prod.sh

echo "🐳 Deploying RMRAS with Docker Production..."

# Build Docker images
echo "🏗️ Building Docker images..."
docker-compose -f docker-compose.yml build

# Start services
echo "🚀 Starting services..."
docker-compose -f docker-compose.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Run migrations
echo "📊 Running database migrations..."
docker-compose -f docker-compose.yml exec app npm run prisma:deploy

# Seed database
echo "🌱 Seeding database..."
docker-compose -f docker-compose.yml exec app npm run prisma:seed

echo "✅ Docker deployment completed successfully!"
echo ""
echo "Services:"
echo "  - API: https://api.rmras.com"
echo "  - Swagger: https://api.rmras.com/api/docs"
echo "  - PgAdmin: http://localhost:5050"
