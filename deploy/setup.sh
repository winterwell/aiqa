#!/bin/bash
# Quick setup script for initial server deployment
# Run this on your Ubuntu server after cloning the repo

set -e

echo "Setting up AIQA deployment directories..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Please install Node.js 20+ first."
    exit 1
fi

# Check for pnpm, install if missing
if ! command -v pnpm &> /dev/null; then
    echo "pnpm not found, installing..."
    npm install -g pnpm
fi

# Create directories
sudo mkdir -p /opt/aiqa/server
sudo mkdir -p /opt/aiqa/webapp/dist
sudo chown -R $USER:$USER /opt/aiqa

echo "Installing systemd service files..."

# Install server service
sudo cp deploy/aiqa-server.service /etc/systemd/system/

# Install nginx config for webapp
sudo cp deploy/aiqa-webapp.nginx.conf /etc/nginx/sites-available/webapp
if [ ! -L /etc/nginx/sites-enabled/webapp ]; then
    sudo ln -s /etc/nginx/sites-available/webapp /etc/nginx/sites-enabled/
fi

# Install nginx config for website (optional)
# sudo cp deploy/aiqa-website.nginx.conf /etc/nginx/sites-available/website
# if [ ! -L /etc/nginx/sites-enabled/website ]; then
#     sudo ln -s /etc/nginx/sites-available/website /etc/nginx/sites-enabled/
# fi

# Disable default nginx site if it exists
if [ -L /etc/nginx/sites-enabled/default ]; then
    sudo rm /etc/nginx/sites-enabled/default
fi

# Test nginx config
sudo nginx -t

# Reload systemd
sudo systemctl daemon-reload

echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Configure /opt/aiqa/server/.env with your database credentials"
echo "2. Enable services: sudo systemctl enable aiqa-server"
echo "3. Start services: sudo systemctl start aiqa-server && sudo systemctl reload nginx"
echo "4. Check status: sudo systemctl status aiqa-server && sudo systemctl status nginx"

