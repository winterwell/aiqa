#!/bin/bash
# Diagnostic script for app.aiqa.winterwell.com connectivity issues
# Run this on the server to identify problems

echo "=== Diagnosing app.aiqa.winterwell.com ==="
echo ""

# Check DNS resolution
echo "1. Checking DNS resolution..."
nslookup app.aiqa.winterwell.com || dig app.aiqa.winterwell.com +short
echo ""

# Check if nginx is running
echo "2. Checking nginx status..."
sudo systemctl status nginx --no-pager -l | head -20
echo ""

# Check if nginx config exists
echo "3. Checking nginx configuration..."
if [ -f /etc/nginx/sites-available/webapp ]; then
    echo "✓ Config file exists: /etc/nginx/sites-available/webapp"
else
    echo "✗ Config file MISSING: /etc/nginx/sites-available/webapp"
    # Try to find the source file
    if [ -f "$(dirname "$0")/app.aiqa.nginx.conf" ]; then
        source_file="$(dirname "$0")/app.aiqa.nginx.conf"
        echo "  Source file found: $source_file"
        echo "  Run: sudo cp $source_file /etc/nginx/sites-available/webapp"
    elif [ -f "deploy/app.aiqa.nginx.conf" ]; then
        echo "  Source file found: deploy/app.aiqa.nginx.conf"
        echo "  Run: sudo cp deploy/app.aiqa.nginx.conf /etc/nginx/sites-available/webapp"
    else
        echo "  Source file: deploy/app.aiqa.nginx.conf (copy from repo to server)"
        echo "  Run: sudo cp deploy/app.aiqa.nginx.conf /etc/nginx/sites-available/webapp"
    fi
fi

if [ -L /etc/nginx/sites-enabled/webapp ]; then
    echo "✓ Config is enabled (symlinked)"
elif [ -f /etc/nginx/sites-available/webapp ]; then
    echo "✗ Config is NOT enabled (missing symlink)"
    echo "  Run: sudo ln -s /etc/nginx/sites-available/webapp /etc/nginx/sites-enabled/webapp"
else
    echo "✗ Config is NOT enabled (config file doesn't exist yet)"
fi
echo ""

# Check nginx config syntax
echo "4. Testing nginx configuration..."
sudo nginx -t 2>&1
echo ""

# Check if webapp files exist
echo "5. Checking webapp files..."
if [ -d /opt/aiqa/webapp/dist ]; then
    file_count=$(find /opt/aiqa/webapp/dist -type f | wc -l)
    if [ "$file_count" -gt 0 ]; then
        echo "✓ Webapp directory exists with $file_count files"
        if [ -f /opt/aiqa/webapp/dist/index.html ]; then
            echo "✓ index.html exists"
        else
            echo "✗ index.html MISSING"
        fi
    else
        echo "✗ Webapp directory exists but is EMPTY"
        echo "  Need to deploy webapp files to /opt/aiqa/webapp/dist"
    fi
else
    echo "✗ Webapp directory MISSING: /opt/aiqa/webapp/dist"
    echo "  Run: sudo mkdir -p /opt/aiqa/webapp/dist"
fi
echo ""

# Check nginx log directories
echo "6. Checking nginx log directories..."
if [ -d /var/log/nginx/app.aiqa.winterwell.com ]; then
    echo "✓ Log directory exists"
else
    echo "✗ Log directory MISSING: /var/log/nginx/app.aiqa.winterwell.com"
    echo "  Run: sudo mkdir -p /var/log/nginx/app.aiqa.winterwell.com && sudo chown -R www-data:www-data /var/log/nginx/"
fi
echo ""

# Check if nginx is listening on ports
echo "7. Checking if nginx is listening on ports 80 and 443..."
sudo netstat -tulpn | grep -E ':(80|443)' | grep nginx || echo "✗ Nginx not listening on ports 80/443"
echo ""

# Check SSL certificate
echo "8. Checking SSL certificate..."
if [ -f /etc/letsencrypt/live/winterwell.com-0002/fullchain.pem ]; then
    echo "✓ SSL certificate file exists"
    sudo openssl x509 -in /etc/letsencrypt/live/winterwell.com-0002/fullchain.pem -noout -subject -dates 2>/dev/null || echo "✗ Certificate file exists but may be invalid"
else
    echo "✗ SSL certificate MISSING: /etc/letsencrypt/live/winterwell.com-0002/fullchain.pem"
    echo "  May need to run: sudo certbot certonly --nginx -d app.aiqa.winterwell.com"
fi
echo ""

# Check recent nginx error logs
echo "9. Recent nginx error logs (last 20 lines)..."
if [ -f /var/log/nginx/app.aiqa.winterwell.com/error.log ]; then
    sudo tail -20 /var/log/nginx/app.aiqa.winterwell.com/error.log
elif [ -f /var/log/nginx/error.log ]; then
    sudo tail -20 /var/log/nginx/error.log | grep -i app.aiqa || echo "No app.aiqa errors in main log"
else
    echo "No error log found"
fi
echo ""

# Test local connectivity
echo "10. Testing local HTTP connection..."
curl -I http://localhost 2>&1 | head -5 || echo "✗ Cannot connect to localhost:80"
echo ""

echo "=== Summary ==="
echo "If issues were found above, fix them and then:"
echo "  sudo systemctl reload nginx"
echo "  sudo systemctl restart nginx  # if reload doesn't work"
echo ""
