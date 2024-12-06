import mysql from 'mysql2/promise';
import { logger } from './logger.js';

export class SQLService {
    constructor(tunnelInfo) {
        if (!tunnelInfo?.database?.[0]) {
            throw new Error('Invalid tunnel info: missing database configuration');
        }

        const dbInfo = tunnelInfo.database[0];

        this.connectionConfig = {
            host: dbInfo.host,
            user: dbInfo.username,
            password: dbInfo.password,
            database: dbInfo.path,
            port: parseInt(dbInfo.port),
            connectTimeout: 10000
        };

        logger.debug('SQL Service initialized with config:', {
            host: this.connectionConfig.host,
            user: this.connectionConfig.user,
            database: this.connectionConfig.database,
            port: this.connectionConfig.port
        });
    }

    getConnectionConfig(useLocalNode = false) {
        if (useLocalNode && !process.env.LOCAL_MARIADB_PORT) {
            throw new Error('LOCAL_MARIADB_PORT not configured in environment');
        }

        return {
            ...this.connectionConfig,
            port: useLocalNode ? parseInt(process.env.LOCAL_MARIADB_PORT) : this.connectionConfig.port
        };
    }

    async executeQuery(query, useLocalNode = false) {
        const config = this.getConnectionConfig(useLocalNode);
        let connection;

        try {
            logger.debug('Attempting SQL connection:', {
                config: {
                    host: config.host,
                    user: config.user,
                    database: config.database,
                    port: config.port
                },
                query,
                useLocalNode
            });

            connection = await mysql.createConnection(config);
            const [results] = await connection.execute(query);

            logger.debug('Query executed successfully:', {
                query,
                resultCount: Array.isArray(results) ? results.length : 'N/A'
            });

            return results;
        } catch (error) {
            logger.error('SQL query execution failed:', {
                error: error.message,
                query,
                useLocalNode,
                config: {
                    host: config.host,
                    user: config.user,
                    database: config.database,
                    port: config.port
                }
            });
            throw error;
        } finally {
            if (connection) {
                try {
                    await connection.end();
                } catch (err) {
                    logger.error('Error closing connection:', {
                        error: err.message
                    });
                }
            }
        }
    }
}