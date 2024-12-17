// src/services/commandsManagerService.js
import { pool } from '../config/database.js';
import { logger } from './logger.js';

export class CommandService {
    async create(command) {
        try {
            // Remove surrounding quotes if present and parse JSON if needed
            const processedCommand = this.processCommandString(command.command);
            
            const [result] = await pool.execute(
                'INSERT INTO commands (title, command, description, service_type, execute_on_all_nodes, auto_run, component_code, layout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    command.title,
                    processedCommand,
                    command.description,
                    command.serviceType,
                    command.executeOnAllNodes ?? false,
                    command.autoRun ?? true,
                    command.componentCode ?? null,
                    command.layout ?? null
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
            // Remove surrounding quotes if present and parse JSON if needed
            const processedCommand = this.processCommandString(command.command);
            
            // Ensure all parameters are defined with fallbacks
            const params = [
                command.title || '',
                processedCommand,
                command.description || null,
                command.serviceType || '',
                command.executeOnAllNodes ?? false,
                command.autoRun ?? true,
                command.componentCode || null,
                command.layout || null,
                id
            ];

            // Log the parameters for debugging
            logger.debug('Updating command with params:', params);

            await pool.execute(
                'UPDATE commands SET title = ?, command = ?, description = ?, service_type = ?, execute_on_all_nodes = ?, auto_run = ?, component_code = ?, layout = ? WHERE id = ?',
                params
            );
            
            return { success: true };
        } catch (error) {
            logger.error('Failed to update command:', error);
            throw error;
        }
    }

    processCommandString(command) {
        if (!command) return '';
        
        // If it's already an object/array, stringify it
        if (typeof command === 'object') {
            return JSON.stringify(command);
        }

        let processedCommand = command;
        
        if (typeof processedCommand === 'string') {
            processedCommand = processedCommand.replace(/"/g, '\\"'); // Escape double quotes
        }
        
        return processedCommand;
    }

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
    }

    async getById(id) {
        try {
            const [rows] = await pool.execute('SELECT * FROM commands WHERE id = ?', [id]);
            return rows.map(row => ({
                id: row.id,
                title: row.title,
                command: row.command,
                description: row.description,
                service_type: row.service_type,
                execute_on_all_nodes: row.execute_on_all_nodes,
                auto_run: row.auto_run,
                component_code: row.component_code,
                layout: row.layout, // Add layout
                created_at: row.created_at,
                updated_at: row.updated_at
            }));
        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    }

    async getAll() {
        try {
            const [rows] = await pool.execute('SELECT * FROM commands ORDER BY id ASC');
            return rows.map(row => ({
                id: row.id,
                title: row.title,
                command: row.command,
                description: row.description,
                service_type: row.service_type,
                execute_on_all_nodes: row.execute_on_all_nodes,
                auto_run: row.auto_run,
                component_code: row.component_code,
                layout: row.layout, // Add layout
                created_at: row.created_at,
                updated_at: row.updated_at
            }));
        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    }
}