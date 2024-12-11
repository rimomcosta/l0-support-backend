// src/services/commandsManagerService.js
import { pool } from '../config/database.js';
import { logger } from './logger.js';

export class CommandService {
    async create(command) {
        try {
            const [result] = await pool.execute(
                'INSERT INTO commands (title, command, service_type, execute_on_all_nodes) VALUES (?, ?, ?, ?)',
                [
                    command.title,
                    JSON.stringify(command.command),
                    command.serviceType,
                    command.executeOnAllNodes ?? false
                ]
            );
            return result.insertId;
        } catch (error) {
            logger.error('Failed to create command:', error);
            throw error;
        }
    } // Review done 

    async update(id, command) {
        try {
            await pool.execute(
                'UPDATE commands SET title = ?, command = ?, service_type = ?, execute_on_all_nodes = ? WHERE id = ?',
                [
                    command.title,
                    JSON.stringify(command.command),
                    command.serviceType,
                    command.executeOnAllNodes ?? false,
                    id
                ]
            );
        } catch (error) {
            logger.error('Failed to update command:', error);
            throw error;
        }
    } // Review done

    async delete(id) {
        try {
            const [result] = await pool.execute('DELETE FROM commands WHERE id = ?', [id]);
            
            if (result.affectedRows > 0) {
                return { success: true, message: `Command with id ${id} deleted.` };
            } else {
                logger.warn(`No command found with id ${id}.`);
                return { success: false, message: `No command found with id ${id}.` };
            }
        } catch (error) {
            logger.error('Failed to delete command:', error);
            throw error;
        }
    } // Review done

    async getById(id) {
        try {
            const [rows] = await pool.execute('SELECT * FROM commands WHERE id = ?', [id]);
            return rows.map(row => ({
                id: row.id,
                title: row.title,
                command: row.command,
                service_type: row.service_type,
                execute_on_all_nodes: row.execute_on_all_nodes,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));
        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    } // Review done

    async getAll() {
        try {
            const [rows] = await pool.execute('SELECT * FROM commands ORDER BY id ASC');
            return rows.map(row => ({
                id: row.id,
                title: row.title,
                command: row.command,
                service_type: row.service_type,
                execute_on_all_nodes: row.execute_on_all_nodes,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));
        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    } // Review done
}