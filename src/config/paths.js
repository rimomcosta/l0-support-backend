// src/config/paths.js
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

export const paths = {
    resources: {
        magentoCloud: join(rootDir, 'resources', 'magento-cloud')
    }
};