import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/lib/crypto.js';

describe('AES-256-GCM Encryption / Decryption', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('performs roundtrip encryption and decryption successfully', () => {
    const secret = 'MySuperSecretSmtpPassword123!@#';
    const encrypted = encrypt(secret, testKey);

    expect(encrypted).not.toBe(secret);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(secret);
  });

  it('generates different ciphertexts for identical plaintext due to random IV', () => {
    const text = 'IdenticalPlaintext';
    const enc1 = encrypt(text, testKey);
    const enc2 = encrypt(text, testKey);

    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1, testKey)).toBe(text);
    expect(decrypt(enc2, testKey)).toBe(text);
  });

  it('throws when ciphertext is tampered with', () => {
    const text = 'SensitiveData';
    const encrypted = encrypt(text, testKey);
    const parts = encrypted.split(':');

    // Modify the ciphertext part
    const tamperedCipher = parts[2].slice(0, -2) + (parts[2].endsWith('a') ? 'b' : 'a');
    const tampered = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

    expect(() => decrypt(tampered, testKey)).toThrow();
  });

  it('throws when auth tag is tampered with', () => {
    const text = 'SensitiveData';
    const encrypted = encrypt(text, testKey);
    const parts = encrypted.split(':');

    // Tamper with the authentication tag
    const tamperedTag = parts[1].slice(0, -2) + (parts[1].endsWith('0') ? '1' : '0');
    const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    expect(() => decrypt(tampered, testKey)).toThrow();
  });

  it('fails with invalid key length', () => {
    expect(() => encrypt('test', 'invalid-short-key')).toThrow(
      'Encryption key must be a 64-character hex string'
    );
  });
});
