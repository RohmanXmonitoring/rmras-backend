#!/bin/bash
# scripts/setup.sh

echo "🚀 Setting up RMRAS Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20+"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Copy environment file
echo "📝 Setting up environment variables..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Please update .env file with your configuration"
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Run database migrations
echo "📊 Running database migrations..."
npx prisma migrate deploy

# Seed database
echo "🌱 Seeding database..."
npm run prisma:seed

# Build the application
echo "🏗️ Building the application..."
npm run build

echo "✅ Setup completed successfully!"
echo ""
echo "To start the application:"
echo "  npm run start:pm2"
echo ""
echo "To view logs:"
echo "  npm run logs:pm2"
