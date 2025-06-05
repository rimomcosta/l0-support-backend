// src/services/commandsManagerService.js
import { pool } from '../config/database.js';
import { logger } from './logger.js';

export class CommandService {
    async create(command) {
        try {
            const processedCommand = this.processCommandString(command.command);
            const [result] = await pool.execute(
                'INSERT INTO commands (title, command, description, service_type, execute_on_all_nodes, allow_ai, auto_run, component_code, locked, reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    command.title,
                    processedCommand,
                    command.description,
                    command.serviceType,
                    command.executeOnAllNodes ? 1 : 0,
                    command.allowAi ? 1 : 0,
                    command.autoRun ? 1 : 0,
                    command.componentCode || null,
                    command.locked ? 1 : 0,
                    command.reviewed ? 1 : 0
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
                command.executeOnAllNodes ? 1 : 0,
                command.allowAi ? 1 : 0,
                command.autoRun ? 1 : 0,
                command.componentCode || null,
                command.reviewed ? 1 : 0,
                id
            ];
            await pool.execute(
                'UPDATE commands SET title = ?, command = ?, description = ?, service_type = ?, execute_on_all_nodes = ?, allow_ai = ?, auto_run = ?, component_code = ?, reviewed = ? WHERE id = ?',
                params
            );

            return { success: true };
        } catch (error) {
            logger.error('Failed to update command:', error);
            throw error;
        }
    }



    async updateToggle(id, changes, user) {
        // 1) Buscar o registro no DB
        const [rows] = await pool.execute('SELECT * FROM commands WHERE id = ?', [id]);
        if (!rows.length) {
            throw new Error(`Command with id=${id} not found.`);
        }
        const existing = rows[0];

        // 2) Se estiver locked e não estamos explicitamente desbloqueando => erro
        if (existing.locked && changes.locked !== false) {
            throw new Error('This command is locked and cannot be modified');
        }

        // 3) Campos booleans que podem ser "toggleados" neste endpoint
        //    (todos exigem admin se forem alterados)
        const toggleFields = [
            'locked',
            'reviewed',
            'allow_ai',
            'auto_run',
            'execute_on_all_nodes'
        ];

        // Preparar valores finais (newVals)
        // Vamos guardar no objeto final o que será salvo no DB
        const newVals = {
            locked: existing.locked,
            reviewed: existing.reviewed,
            allow_ai: existing.allow_ai,
            auto_run: existing.auto_run,
            execute_on_all_nodes: existing.execute_on_all_nodes
        };

        // 4) Checar cada um, se o valor está mudando => requer admin
        for (const field of toggleFields) {
            if (field in changes) {
                const oldVal = !!existing[field];
                const newVal = !!changes[field];
                if (newVal !== oldVal) {
                    // mudança real => exige admin
                    if (!user?.isAdmin) {
                        throw new Error('This action requires admin role');
                    }
                    newVals[field] = changes[field]; // Usa o valor exato do request
                }
            }
        }

        // 5) Rodar o UPDATE apenas nos campos toggles
        try {
            const sql = `
            UPDATE commands
            SET
              locked = ?,
              reviewed = ?,
              allow_ai = ?,
              auto_run = ?,
              execute_on_all_nodes = ?
            WHERE id = ?
          `;
            const params = [
                newVals.locked,
                newVals.reviewed,
                newVals.allow_ai,
                newVals.auto_run,
                newVals.execute_on_all_nodes,
                id
            ];

            await pool.execute(sql, params);
            return { success: true };
        } catch (error) {
            logger.error('Failed to update toggle fields:', error);
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
                execute_on_all_nodes: row.execute_on_all_nodes === 1,
                allow_ai: row.allow_ai === 1,
                auto_run: row.auto_run === 1,
                component_code: row.component_code,
                locked: row.locked === 1,
                reviewed: row.reviewed === 1,
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
                execute_on_all_nodes: row.execute_on_all_nodes === 1,
                allow_ai: row.allow_ai === 1,
                auto_run: row.auto_run === 1,
                component_code: row.component_code,
                locked: row.locked === 1,
                reviewed: row.reviewed === 1,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));

        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    }

    async getByServiceType(service_type) {
        try {
            const [rows] = await pool.execute('SELECT * FROM commands where service_type = ? ORDER BY id ASC', [service_type]);
            return rows.map(row => ({
                id: row.id,
                title: row.title,
                command: row.command,
                description: row.description,
                service_type: row.service_type,
                execute_on_all_nodes: row.execute_on_all_nodes === 1,
                allow_ai: row.allow_ai === 1,
                auto_run: row.auto_run === 1,
                component_code: row.component_code,
                locked: row.locked === 1,
                reviewed: row.reviewed === 1,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));

        } catch (error) {
            logger.error('Failed to get commands:', error);
            throw error;
        }
    }
}