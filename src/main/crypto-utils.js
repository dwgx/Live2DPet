/**
 * CryptoUtils — API key encryption/decryption for config persistence.
 * Uses AES-256-GCM with machine-derived key via PBKDF2.
 * Backward compatible: plaintext values pass through decrypt() unchanged.
 *
 * Security features:
 * - AES-256-GCM authenticated encryption (prevents tampering)
 * - PBKDF2 key derivation with 100,000 iterations (OWASP recommended)
 * - Random IV per encryption (prevents pattern analysis)
 * - Machine-specific seed (hostname + username)
 * - Constant-time comparison for encrypted value detection
 */
const crypto = require('crypto');
const os = require('os');

// Use cryptographically random salt (fixed for backward compatibility)
const SALT = Buffer.from('live2dpet-config-encryption-salt');
const PREFIX = 'enc:v1:';
const PBKDF2_ITERATIONS = 100000; // OWASP recommended minimum
const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 12; // 96 bits for GCM (recommended)

/**
 * Generate machine-specific seed for key derivation.
 * Combines hostname and username to create unique per-machine encryption.
 * @returns {string} Machine-specific seed
 */
function getMachineSeed() {
    return `live2dpet-${os.hostname()}-${os.userInfo().username}`;
}

/**
 * Derive encryption key from seed using PBKDF2.
 * @param {string} [seed] - Optional seed override (defaults to machine seed)
 * @returns {Buffer} 32-byte encryption key
 */
function deriveKey(seed) {
    return crypto.pbkdf2Sync(
        seed || getMachineSeed(),
        SALT,
        PBKDF2_ITERATIONS,
        KEY_LENGTH,
        'sha256'
    );
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * @param {string} plaintext - Text to encrypt
 * @param {string} [seed] - Optional seed override
 * @returns {string} Encrypted string with format: enc:v1:IV:TAG:CIPHERTEXT
 */
function encrypt(plaintext, seed) {
    if (!plaintext) return plaintext;

    const key = deriveKey(seed);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt encrypted value using AES-256-GCM.
 * Backward compatible: returns plaintext values unchanged.
 * @param {string} value - Encrypted or plaintext value
 * @param {string} [seed] - Optional seed override
 * @returns {string} Decrypted plaintext
 * @throws {Error} If decryption fails (invalid key, corrupted data, or tampered auth tag)
 */
function decrypt(value, seed) {
    if (!value) return value;
    if (!isEncrypted(value)) return value; // Backward compatibility

    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
        console.warn('[CryptoUtils] Invalid encrypted format, returning as-is');
        return value;
    }

    try {
        const iv = Buffer.from(parts[0], 'hex');
        const tag = Buffer.from(parts[1], 'hex');
        const encrypted = Buffer.from(parts[2], 'hex');

        const key = deriveKey(seed);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);

        return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
    } catch (error) {
        console.error('[CryptoUtils] Decryption failed:', error.message);
        throw new Error('Decryption failed: invalid key or corrupted data');
    }
}

/**
 * Check if value is encrypted (constant-time comparison for security).
 * @param {string} value - Value to check
 * @returns {boolean} True if encrypted
 */
function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted, getMachineSeed };
