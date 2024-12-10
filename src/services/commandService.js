import { pool } from '../config/database.js';
import { logger } from './logger.js';

export class CommandService {
    async create(command) {
        try {
            // Convert command to JSON string if it's an object
            const commandValue = typeof command.command === 'object' 
                ? JSON.stringify(command.command)
                : JSON.stringify({ value: command.command });

            const [result] = await pool.execute(
                'INSERT INTO commands (title, command, service_type, execute_on_all_nodes) VALUES (?, ?, ?, ?)',
                [
                    command.title,
                    commandValue,
                    command.serviceType,
                    command.executeOnAllNodes
                ]
            );
            return result.insertId;
        } catch (error) {
            logger.error('Failed to create command:', error);
            throw error;
        }
    }

    async update(id, command) {
        try {
            const commandValue = typeof command.command === 'object' 
                ? JSON.stringify(command.command)
                : JSON.stringify({ value: command.command });

            await pool.execute(
                'UPDATE commands SET title = ?, command = ?, service_type = ?, execute_on_all_nodes = ? WHERE id = ?',
                [
                    command.title,
                    commandValue,
                    command.serviceType,
                    command.executeOnAllNodes,
                    id
                ]
            );
        } catch (error) {
            logger.error('Failed to update command:', error);
            throw error;
        }
    }

    async delete(id) {
        try {
            await pool.execute('DELETE FROM commands WHERE id = ?', [id]);
        } catch (error) {
            logger.error('Failed to delete command:', error);
            throw error;
        }
    }

    async getById(id) {
        try {
            const [rows] = await pool.execute('SELECT * FROM commands WHERE id = ?', [id]);
            if (rows[0]) {
                rows[0].command = JSON.parse(rows[0].command);
            }
            return rows[0];
        } catch (error) {
            logger.error('Failed to get command:', error);
            throw error;
        }
    }

    async getAll() {
        try {
            const [rows] = await pool.execute('SELECT * FROM commands ORDER BY created_at DESC');
            return rows.map(row => ({
                ...row,
                command: JSON.parse(row.command)
            }));
        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    }
}