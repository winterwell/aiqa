#!/bin/bash
# Quick setup script for initial server deployment
# Run this on your Ubuntu server after cloning the repo
# Must be run from the repository root directory

set -e

# Check if we're in the right directory
if [ ! -d "deploy" ] || [ ! -f "deploy/setup.sh" ]; then
    echo "Error: This script must be run from the repository root directory"
    echo "Current directory: $(pwd)"
    exit 1
fi

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
sudo cp deploy/app-aiqa.nginx.conf /etc/nginx/sites-available/app-aiqa.nginx.conf
if [ ! -L /etc/nginx/sites-enabled/app-aiqa.nginx.conf ]; then
    sudo ln -s /etc/nginx/sites-available/app-aiqa.nginx.conf /etc/nginx/sites-enabled/
fi

# Install nginx config for server API domain (optional)
# sudo cp deploy/server-aiqa.nginx.conf /etc/nginx/sites-available/server-aiqa.nginx.conf
# if [ ! -L /etc/nginx/sites-enabled/server-aiqa.nginx.conf ]; then
#     sudo ln -s /etc/nginx/sites-available/server-aiqa.nginx.conf /etc/nginx/sites-enabled/
# fi

# Install nginx config for website (optional)
# sudo cp deploy/website-aiqa.nginx.conf /etc/nginx/sites-available/website
# if [ ! -L /etc/nginx/sites-enabled/website ]; then
#     sudo ln -s /etc/nginx/sites-available/website /etc/nginx/sites-enabled/
# fi

# Create nginx log directories (required before nginx can start)
sudo mkdir -p /var/log/nginx/app-aiqa.winterwell.com
sudo mkdir -p /var/log/nginx/aiqa.winterwell.com
sudo mkdir -p /var/log/nginx/server-aiqa.winterwell.com  # if using server domain
sudo chown -R www-data:www-data /var/log/nginx/

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
echo "1. If deploying from git, ensure submodules are initialized: git submodule update --init --recursive"
echo "2. Configure /opt/aiqa/server/.env with your database credentials"
echo "3. Enable services: sudo systemctl enable aiqa-server"
echo "4. Start services: sudo systemctl start aiqa-server && sudo systemctl reload nginx"
echo "5. Check status: sudo systemctl status aiqa-server && sudo systemctl status nginx"

