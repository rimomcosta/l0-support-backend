// src/services/encryptionService.js
import crypto from 'crypto';

const algorithm = 'aes-256-cbc';
const keyLength = 32; // AES-256 requires a 32-byte key

export class EncryptionService {
    static generateSalt() {
        return crypto.randomBytes(16).toString('hex');
    }

    static deriveKey(password, salt) {
        return crypto.pbkdf2Sync(password, salt, 100000, keyLength, 'sha512');
    }

    static encrypt(text, password, salt) {
        const key = this.deriveKey(password, salt);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf-8', 'hex');
        encrypted += cipher.final('hex');
        return `${salt}:${iv.toString('hex')}:${encrypted}`;
    }

    static decrypt(encryptedText, password) {
        const [salt, ivHex, encrypted] = encryptedText.split(':');
        const key = this.deriveKey(password, salt);
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return decrypted;
    }
}