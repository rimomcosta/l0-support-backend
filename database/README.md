# Database Setup System for L0 Support

## Overview

This directory contains the complete database setup system for the L0 Support application. The system provides a professional, automated way for developers to set up their local development environment with a single command.

## Architecture

### Files Structure
```
Backend/database/
├── README.md              # This documentation
├── seed.sql              # Safe seed file (mock user only)
├── commands_seed.sql     # Complete commands backup (47 commands)
└── mock_user_data.sql    # Mock user data only
```

### Setup Script
```
Backend/scripts/
└── setup-database.js     # Main setup automation script
```

## Quick Start

For new developers setting up the project for the first time:

```bash
cd Backend
npm install
npm run setup
npm run dev
```

## How It Works

### 1. Database Creation
- Creates `l0support` database if it doesn't exist
- Uses UTF8MB4 character set for full Unicode support
- Handles connection errors gracefully

### 2. Data Import Process
The setup script executes two SQL files in sequence:

1. **`seed.sql`** - Adds the mock development user safely
2. **`commands_seed.sql`** - Imports all 47 monitoring commands

### 3. Safety Mechanisms
- Uses `INSERT IGNORE` to prevent conflicts with existing data
- Preserves existing commands and users
- Provides detailed error messages and rollback information

## What the Setup Does

The `npm run setup` command:

1. **Creates the database** if it doesn't exist
2. **Imports all commands** - adds all 47 monitoring commands from the backup
3. **Adds mock user** - safely inserts the development user (`dev-admin@example.com`) if it doesn't exist
4. **Verifies setup** - confirms that the database is ready with all data

## Database Schema

The application uses the following tables:

- **`commands`** - Contains all the monitoring commands (47 records)
  - Complex commands with JavaScript component_code
  - Service types: SSH, SQL, Redis, OpenSearch, Magento Cloud, Bash, RabbitMQ
  - Includes descriptions, auto-run settings, and review status

- **`users`** - User accounts (mock user added safely)
  - User authentication and authorization
  - API token management
  - Salt-based security

- **`chat_sessions`** - Chat session data (populated by application)
- **`chat_messages`** - Chat message history (populated by application)
- **`dashboard_layouts`** - User dashboard configurations (populated by application)
- **`feedback`** - User feedback data (populated by application)
- **`user_ai_settings`** - AI configuration settings (populated by application)
- **`transaction_analysis`** - Transaction analysis data (populated by application)

## Command Types Available

The system includes 47 pre-configured commands across multiple service types:

### Redis Commands
- Redis Ping, Info Keyspace
- Memory usage monitoring
- Cache configuration checks

### SQL Commands
- MySQL version and process monitoring
- Database health checks

### SSH Commands
- System load monitoring
- Disk usage analysis
- OS and PHP version checks
- Magento version detection

### Magento Cloud Commands
- Environment listing
- Configuration file access
- Project information retrieval
- SSH link generation

### OpenSearch Commands
- Cluster health monitoring
- Index management

### RabbitMQ Commands
- Queue overview and monitoring

## Environment Variables

The setup script uses these environment variables (with defaults):

- `DB_HOST` (default: `127.0.0.1`)
- `DB_USER` (default: `root`)
- `DB_PASSWORD` (default: empty)

## Development Workflow

1. **First time setup**: Run `npm run setup` to get the complete environment (all 47 commands + mock user)
2. **Daily development**: Just run `npm run dev` to start the backend
3. **Adding new commands**: Use the application interface or direct database access
4. **Recovery**: If commands are lost, run `npm run setup` again to restore everything

## Security Features

- **Mock user isolation**: Development user is separate from production users
- **Safe insertion**: Uses `INSERT IGNORE` to prevent data conflicts
- **No data loss**: Existing data is never overwritten during setup
- **Environment separation**: Development and production configurations are separate

## Troubleshooting

### Database Connection Issues
- Ensure MySQL/MariaDB is running
- Check that the database user has proper permissions
- Verify the connection details in environment variables

### Missing Commands
If commands are accidentally deleted, restore them:
```bash
mysql -uroot -h127.0.0.1 -Dl0support < database/commands_seed.sql
```

### Setup Script Errors
- Check that Node.js and npm are installed
- Ensure all dependencies are installed (`npm install`)
- Verify the database server is accessible

### Permission Issues
- Ensure the MySQL user has CREATE DATABASE privileges
- Check file permissions for SQL files
- Verify network connectivity to database server

## Manual Setup (Alternative)

If you prefer to set up the database manually:

```bash
# Create database
mysql -uroot -h127.0.0.1 -e "CREATE DATABASE IF NOT EXISTS l0support CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Import commands
mysql -uroot -h127.0.0.1 -Dl0support < database/commands_seed.sql

# Add mock user
mysql -uroot -h127.0.0.1 -Dl0support < database/seed.sql
```

## Backup and Recovery

### Creating Backups
```bash
# Backup commands table
mysqldump -uroot -h127.0.0.1 l0support commands > commands_backup.sql

# Backup entire database
mysqldump -uroot -h127.0.0.1 l0support > full_backup.sql
```

### Restoring from Backup
```bash
# Restore commands only
mysql -uroot -h127.0.0.1 -Dl0support < commands_backup.sql

# Restore entire database
mysql -uroot -h127.0.0.1 -Dl0support < full_backup.sql
```

## Production Considerations

- **Do not use mock user in production**
- **Implement proper user authentication**
- **Use environment-specific database configurations**
- **Regular backup schedules**
- **Monitor database performance**

## Technical Implementation Details

### Setup Script Architecture
- **Modular design**: Separate functions for database creation, population, and verification
- **Error handling**: Comprehensive try-catch blocks with detailed error messages
- **Child process execution**: Uses Node.js child_process for MySQL client execution
- **Path resolution**: Dynamic path resolution for cross-platform compatibility

### SQL File Structure
- **Standard MySQL dump format**: Compatible with all MySQL/MariaDB versions
- **Transaction safety**: Uses START TRANSACTION and COMMIT
- **Character set specification**: Explicit UTF8MB4 for full Unicode support
- **Index optimization**: Proper indexing for performance

### Performance Considerations
- **Connection pooling**: Efficient database connection management
- **Batch operations**: Optimized for bulk data import
- **Memory management**: Proper cleanup of database connections

## Contributing

When adding new commands or modifying the setup:

1. **Update commands_seed.sql** with new command data
2. **Test the setup script** on a clean database
3. **Update this documentation** with any changes
4. **Verify backward compatibility** with existing installations

## Version History

- **v1.0**: Initial setup system with basic database creation
- **v1.1**: Added commands import functionality
- **v1.2**: Enhanced safety mechanisms and error handling
- **v1.3**: Comprehensive documentation and troubleshooting guide 