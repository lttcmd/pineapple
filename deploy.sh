#!/bin/bash

# DigitalOcean Deployment Script for OFC Pineapple Tournament

echo "🚀 Starting deployment to DigitalOcean..."

# Build the Docker image
echo "📦 Building Docker image..."
docker build -t ofc-pineapple-tourney .

# Tag for DigitalOcean Container Registry (replace with your registry)
# docker tag ofc-pineapple-tourney registry.digitalocean.com/your-registry/ofc-pineapple-tourney:latest

# Push to DigitalOcean Container Registry (uncomment when ready)
# echo "📤 Pushing to DigitalOcean Container Registry..."
# docker push registry.digitalocean.com/your-registry/ofc-pineapple-tourney:latest

echo "✅ Deployment files ready!"
echo ""
echo "Next steps:"
echo "1. Create a DigitalOcean Droplet or App Platform"
echo "2. Update mobile/app/config/env.js with your production server URL"
echo "3. Build and distribute your mobile app with: cd mobile && npx expo build"
echo ""
echo "For DigitalOcean App Platform:"
echo "- Connect your GitHub repo"
echo "- Use the Dockerfile for deployment"
echo "- Set environment variables as needed"
