#!/bin/bash
set -e

echo "🚀 Starting L0 Support Backend..."
echo "📍 Working directory: $(pwd)"

# Wait for database to be ready
echo "⏳ Waiting for database connection..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if mysql -h"${DB_HOST:-localhost}" -u"${DB_USER:-root}" -p"${DB_PASSWORD}" -e "SELECT 1" > /dev/null 2>&1; then
        echo "✅ Database connection established!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "⏳ Database not ready yet (attempt $RETRY_COUNT/$MAX_RETRIES), waiting..."
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "❌ Failed to connect to database after $MAX_RETRIES attempts"
    echo "⚠️  Proceeding anyway - application will attempt connection..."
fi

# Run database setup (safe to run multiple times - checks if already populated)
echo "📦 Running database setup..."
if npm run setup:db; then
    echo "✅ Database setup completed successfully"
else
    echo "⚠️  Database setup encountered an issue - this may be okay if DB is already initialized"
fi

# Start the application
echo "🎯 Starting application server..."
exec npm start
