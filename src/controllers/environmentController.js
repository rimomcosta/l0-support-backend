import { logger } from '../services/logger.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { access, constants } from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function getEnvironments(req, res) {
    const { projectId } = req.params;

    try {
        const magentoCloudPath = join(__dirname, '..', '..', 'resources', 'magento-cloud');

        try {
            await access(magentoCloudPath, constants.X_OK);
            logger.debug('Magento cloud executable found and is executable');
        } catch (err) {
            logger.error('Magento cloud executable access error:', {
                error: err.message,
                path: magentoCloudPath
            });
            throw new Error('Magento cloud executable not found or not executable');
        }

        const command = `${magentoCloudPath} environment:list -p ${projectId}`;
        logger.debug('Executing command:', { command });

        const { stdout, stderr } = await execAsync(command, {
            env: {
                ...process.env,
                PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin`
            }
        });

        logger.debug('Command output:', {
            stdout: stdout,
            stderr: stderr
        });

        const output = stdout + stderr;
        const lines = output.split('\n').filter(line => line.trim());

        logger.debug('Parsed lines:', { lines });

        const environments = [];
        const headerIndex = lines.findIndex(line => line.includes('| ID'));

        if (headerIndex === -1) {
            throw new Error('Could not find table header in command output');
        }

        for (let i = headerIndex + 2; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('+')) continue;

            const cells = line.split('|').map(cell => cell.trim());

            logger.debug('Processing line:', {
                lineNumber: i,
                cells: cells
            });

            if (cells.length >= 5 && cells[3] === 'Active') {
                environments.push({
                    id: cells[1],
                    title: cells[2],
                    status: cells[3],
                    type: cells[4]
                });
            }
        }

        if (environments.length === 0) {
            logger.warn('No active environments found in command output');
        }

        logger.debug('Parsed active environments:', { environments });
        res.json(environments);
    } catch (error) {
        logger.error('Environment list error:', {
            error: error.message,
            stack: error.stack,
            projectId: projectId
        });

        res.status(500).json({
            error: 'Failed to fetch environments',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}