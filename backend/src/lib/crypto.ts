import crypto from 'crypto';
import { getEnv } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes recommended for GCM
const AUTH_TAG_LENGTH = 16; // 16 bytes auth tag

function getKey(overrideKey?: string): Buffer {
  const keyHex = overrideKey || getEnv().CREDENTIAL_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('Encryption key must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts plain text using AES-256-GCM.
 * Output format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
export function encrypt(plaintext: string, overrideKey?: string): string {
  if (!plaintext) {
    throw new Error('Plaintext cannot be empty');
  }

  const key = getKey(overrideKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts ciphertext encrypted with encrypt() using AES-256-GCM.
 */
export function decrypt(encryptedPayload: string, overrideKey?: string): string {
  if (!encryptedPayload) {
    throw new Error('Encrypted payload cannot be empty');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const key = getKey(overrideKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid IV or auth tag length in encrypted payload');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
