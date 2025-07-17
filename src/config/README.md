# Mock User Configuration

This directory contains the centralized configuration for the mock user used in development mode when `USE_OKTA=false`.

## Files

### `mockUser.js`
**Single source of truth** for all mock user data. This file contains:

- `MOCK_USER_CONFIG`: The main configuration object with all user properties
- `getMockUserForSession()`: Returns user object for session creation
- `getMockUserForDatabase()`: Returns user object for database insertion
- `getMockUserInsertSQL()`: Returns SQL for database insertion

## Configuration Properties

| Property | Type | Description | Example |
|----------|------|-------------|---------|
| `id` | string | Unique user identifier | `'dev-admin-user'` |
| `email` | string | User email address | `'dev-admin@example.com'` |
| `name` | string | Display name | `'Development Admin'` |
| `role` | string | User role | `'admin'` |
| `isAdmin` | boolean | Admin privileges | `true` |
| `isUser` | boolean | User privileges | `true` |
| `groups` | array | User groups | `['GRP-L0SUPPORT-ADMIN', 'GRP-L0SUPPORT-USER']` |
| `username` | string | Database username | `'Development Admin'` |
| `salt` | string | Password salt | `'dev-salt-placeholder'` |
| `api_token` | string/null | API token | `null` |

## Usage

### Manual Updates
Edit `src/config/mockUser.js` directly and restart the backend server.

### Using the Update Script
```bash
# Update single property
node scripts/updateMockUser.js name="New Admin Name"

# Update multiple properties
node scripts/updateMockUser.js email="newadmin@example.com" isAdmin=false

# Update groups (comma-separated)
node scripts/updateMockUser.js groups="admin,user,developer"
```

### Manual Session Refresh
If you need to force refresh the session immediately:
```bash
# Using curl
curl -X POST http://localhost:4000/api/v1/auth/refresh-mock-session

# Or visit in browser
http://localhost:4000/api/v1/auth/refresh-mock-session
```

## How It Works

1. **Session Creation**: When `USE_OKTA=false`, the `conditionalAuth` middleware automatically creates a mock user session using `getMockUserForSession()`

2. **Database Insertion**: During app startup, the database initialization automatically inserts the mock user using `getMockUserInsertSQL()`

3. **Automatic Session Refresh**: When the configuration changes, sessions are automatically refreshed on the next request using a configuration hash

4. **Consistency**: All parts of the application use the same configuration, ensuring consistency across sessions, database records, and API responses

## Benefits

- ✅ **Single source of truth**: Change one file, updates everywhere
- ✅ **Type safety**: Helper functions ensure correct data structure
- ✅ **Easy maintenance**: Update script for quick changes
- ✅ **Consistency**: Same user data across all components
- ✅ **Documentation**: Clear structure and comments

## Migration from Old System

The old system had mock user data scattered across:
- `src/middleware/auth.js` (session creation)
- `src/config/initDatabase.js` (database insertion)
- `src/migrations/insert_mock_dev_user.sql` (migration)

Now everything is centralized in `src/config/mockUser.js` with helper functions for different use cases. 