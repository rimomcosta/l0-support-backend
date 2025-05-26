// src/services/encryptionService.js
import crypto from 'crypto';

const algorithm = 'aes-256-cbc';
const keyLength = 32; // AES-256 requires a 32-byte key
const iterations = 100000; // Number of iterations for PBKDF2

export class EncryptionService {
    static generateSalt() {
        return crypto.randomBytes(16).toString('hex');
    }

    static deriveKey(password, salt) {
        return crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha512');
    }

    static encrypt(text, password, salt) {
        const key = this.deriveKey(password, salt);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf-8', 'hex');
        encrypted += cipher.final('hex');
        
        // Clear sensitive data from memory
        key.fill(0);
        
        return `${salt}:${iv.toString('hex')}:${encrypted}`;
    }

    static decrypt(encryptedText, password, salt) {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted text format');
        }
        
        const [storedSalt, ivHex, encrypted] = parts;
        
        // Use the provided salt parameter if available, otherwise use the stored salt
        const saltToUse = salt || storedSalt;
        
        const key = this.deriveKey(password, saltToUse);
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        
        try {
            let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
            decrypted += decipher.final('utf-8');
            
            // Clear sensitive data from memory
            key.fill(0);
            
            return decrypted;
        } catch (error) {
            // Clear sensitive data from memory even on error
            key.fill(0);
            throw new Error('Decryption failed. Invalid password or corrupted data.');
        }
    }
}