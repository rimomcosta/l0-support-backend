import { pool } from '../config/database.js';
import { logger } from './logger.js';

export class CommandService {
    async create(command) {
        try {
            const processedCommand = this.processCommandString(command.command);
            const [result] = await pool.execute(
                'INSERT INTO commands (title, command, description, service_type, execute_on_all_nodes, auto_run, component_code, layout, locked, reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    command.title,
                    processedCommand,
                    command.description,
                    command.serviceType,
                    command.executeOnAllNodes ?? false,
                    command.autoRun ?? true,
                    command.componentCode ?? null,
                    command.layout ?? null,
                    command.locked ?? false,
                    false  // reviewed always starts as false
                ]
            );
            return result.insertId;
        } catch (error) {
            logger.error('Failed to create command:', error);
            throw error;
        }
    }

    async update(id, command) {
        const [existing] = await pool.execute('SELECT locked FROM commands WHERE id = ?', [id]);
        if (existing[0]?.locked) {
            throw new Error('This command is locked and cannot be modified');
        }
        try {
            const processedCommand = this.processCommandString(command.command);
            const params = [
                command.title,
                processedCommand,
                command.description,
                command.serviceType,
                command.executeOnAllNodes ?? false,
                command.autoRun ?? true,
                command.componentCode,
                command.layout,
                command.reviewed,
                id
            ];

            await pool.execute(
                'UPDATE commands SET title = ?, command = ?, description = ?, service_type = ?, execute_on_all_nodes = ?, auto_run = ?, component_code = ?, layout = ?, reviewed = ? WHERE id = ?',
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

        if (typeof command === 'object') {
            return JSON.stringify(command);
        }

        if (typeof command === 'string') {
            return command;
        }

        return '';
    }

    async delete(id) {
        const [existing] = await pool.execute('SELECT locked FROM commands WHERE id = ?', [id]);
        if (existing[0]?.locked) {
            throw new Error('This command is locked and cannot be deleted');
        }
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
                layout: row.layout,
                locked: row.locked,
                reviewed: row.reviewed,
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
                layout: row.layout,
                locked: row.locked,
                reviewed: row.reviewed,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));

        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    }
}