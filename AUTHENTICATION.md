# Authentication System Documentation

## Overview

The L0 Support application uses **Okta OIDC** for authentication in all environments. However, to facilitate development, a conditional authentication system has been implemented.

## Authentication Flow

### Production Mode (`NODE_ENV=production`)
- **Strict Okta authentication required**
- All protected endpoints require valid Okta session
- No mock sessions or bypasses

### Development Mode (`NODE_ENV=development`)
- **Okta authentication preserved when available**
- **Fallback mock session** when no authentication exists
- Enables feature development without constant Okta login

## How It Works

### Conditional Authentication Middleware

The `conditionalAuth` middleware provides development-friendly authentication:

```javascript
// Routes using conditional auth
router.get('/auth/user', conditionalAuth, getUser);
```

#### Behavior by Environment:

1. **If existing session exists (Okta or other)**:
   - ✅ Preserves existing session unchanged
   - ✅ Works with real Okta authentication

2. **If no session exists in development**:
   - ⚠️ Creates temporary mock admin session
   - 📝 Logs warning about mock session usage

3. **Production mode**:
   - 🔒 Always requires strict authentication
   - ❌ No mock sessions created

## Development Workflow

### Option 1: Use Mock Session (Quick Development)
```bash
# Method 1: Direct endpoint access (creates session automatically)
curl http://localhost:4000/api/v1/auth/user
# Returns mock admin user and creates session

# Method 2: Using cookie persistence for multiple requests
curl -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/user
# Creates session and saves cookie to cookies.txt

# Now use the session for other endpoints
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/analyses
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/stats
```

### Option 2: Use Real Okta Authentication
```bash
# Authenticate with Okta first
curl http://localhost:4000/api/v1/auth/login
# Follow Okta flow, then...

curl http://localhost:4000/api/v1/auth/user
# Returns real Okta user session
```

## Mock Session Details

When created in development mode:

```json
{
  "id": "dev-admin-user",
  "email": "dev-admin@example.com", 
  "name": "Development Admin (Mock)",
  "role": "admin",
  "isAdmin": true,
  "isUser": true,
  "groups": ["GRP-L0SUPPORT-ADMIN", "GRP-L0SUPPORT-USER"],
  "__mock": true
}
```

## Security Considerations

- ✅ **Production safety**: Mock sessions never created in production
- ✅ **Okta precedence**: Real Okta sessions always preserved
- ✅ **Clear logging**: Mock session usage is clearly logged
- ✅ **Identifiable**: Mock sessions have `__mock: true` flag

## Cookie Management & Session Testing

### Creating and Using Fake Sessions in Development

#### Method 1: Automatic Session Creation
```bash
# Access any conditionalAuth endpoint - session created automatically
curl http://localhost:4000/api/v1/auth/user
# Response: {"id":"dev-admin-user","email":"dev-admin@example.com",...}
```

#### Method 2: Persistent Cookie Sessions
```bash
# Create a session and save the cookie
curl -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/user

# The cookie file (cookies.txt) now contains your session
# Use it for subsequent requests:
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/analyses
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/stats
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/recent

# Test POST requests with the session
curl -b cookies.txt -X POST -H "Content-Type: application/json" \
  -d '{"payloads":[{"payload":{},"analysisName":"Test"}]}' \
  http://localhost:4000/api/v1/transaction-analysis/analyze-multiple
```

#### Method 3: Frontend Browser Session
```bash
# 1. Open browser to http://localhost:3000
# 2. Navigate to Transaction Analysis page
# 3. Session automatically created when page loads
# 4. Use browser dev tools to inspect session cookie
```

### Complete Endpoint Testing Examples

#### Test Transaction Analysis Endpoints
```bash
# Create session first
curl -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/user

# Test all transaction analysis endpoints
echo "Testing analyses list..."
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/analyses

echo "Testing stats..."
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/stats

echo "Testing recent analyses..."
curl -b cookies.txt http://localhost:4000/api/v1/transaction-analysis/recent

echo "Testing search..."
curl -b cookies.txt "http://localhost:4000/api/v1/transaction-analysis/search?q=test"
```

#### Test with Mock New Relic Payload
```bash
# Create session
curl -c cookies.txt -b cookies.txt http://localhost:4000/api/v1/auth/user

# Create a minimal mock payload
cat > mock_payload.json << 'EOF'
{
  "payloads": [{
    "payload": {
      "data": {
        "actor": {
          "entity": {
            "transactionTrace": {
              "guid": "test-guid",
              "duration": 1000,
              "path": "/test",
              "nodes": [
                {"guid": "root", "name": "Test Transaction", "duration": 1000}
              ],
              "edges": [
                {"parentGuid": "head", "childGuid": "root"}
              ]
            }
          }
        }
      }
    },
    "analysisName": "Test Analysis"
  }]
}
EOF

# Test the analysis endpoint
curl -b cookies.txt -X POST -H "Content-Type: application/json" \
  -d @mock_payload.json \
  http://localhost:4000/api/v1/transaction-analysis/analyze-multiple
```

## Testing Authentication

### Test Real Okta Flow
```bash
# Clear any existing session
curl -X POST http://localhost:4000/api/v1/auth/logout

# Start Okta login
curl http://localhost:4000/api/v1/auth/login
# Follow redirect to complete Okta authentication

# Verify real session
curl http://localhost:4000/api/v1/auth/user
```

### Test Mock Session Fallback
```bash
# Clear session and test direct endpoint access
curl -X POST http://localhost:4000/api/v1/auth/logout
curl http://localhost:4000/api/v1/auth/user
# Should create and return mock session
```

### Session Cleanup
```bash
# Clear session when done testing
curl -X POST http://localhost:4000/api/v1/auth/logout

# Or delete the cookie file
rm cookies.txt
```

## Endpoints Using Conditional Auth

Currently only:
- `GET /api/v1/auth/user` - Get current user session

All other authentication endpoints use strict `requireAuth` middleware.

## Configuration

Set in `.env`:
```env
NODE_ENV=development  # Enables mock session fallback
NODE_ENV=production   # Disables mock sessions
```

## Quick Testing Script

A comprehensive test script is available to validate the entire authentication workflow:

```bash
# Run the test script
./test_auth_workflow.sh
```

This script:
- ✅ Creates mock development sessions
- ✅ Tests session persistence with cookies
- ✅ Validates all transaction analysis endpoints
- ✅ Demonstrates cookie management
- ✅ Verifies Okta authentication is preserved
- ✅ Includes cleanup procedures

The script creates `cookies.txt` which you can reuse for manual testing.

## Troubleshooting

### "Not authenticated" errors in development
- Check that `NODE_ENV=development` in your `.env`
- Verify the endpoint is using `conditionalAuth` middleware
- Check server logs for authentication flow details

### Mock session not working
- Ensure no existing session exists (try logout first)
- Check server logs for authentication middleware execution
- Verify `NODE_ENV` environment variable

### Real Okta authentication issues
- Mock sessions don't interfere with Okta flow
- Use `/api/v1/auth/login` to start fresh Okta authentication
- Check Okta configuration in `.env` file

### Cookie and session issues
- **Cookie not persisting**: Use `-c cookies.txt -b cookies.txt` flags together
- **Session expired**: Delete `cookies.txt` and create a new session
- **Testing with Postman**: Enable "Send cookies with request" in settings
- **Browser testing**: Check Application → Cookies in dev tools for session cookie
- **Empty cookie file**: Normal behavior - session may be in memory, test with endpoints to verify
- **CORS issues**: Session cookies are handled by Express middleware, not visible in curl cookie files

### Debug session state
```bash
# Check what's in your cookie file
cat cookies.txt

# Test session validity
curl -b cookies.txt http://localhost:4000/api/v1/auth/user

# Check server logs for authentication flow
tail -f logs/activity.log | grep -i auth
``` 