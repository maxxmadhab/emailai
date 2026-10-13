import { describe, it, expect } from 'vitest';
import { recipientParserService } from '../../src/services/recipient-parser.service.js';

describe('Recipient Parser & Validator Service', () => {
  it('strips UTF-8 BOM header from files', () => {
    const bomText = '\uFEFFjohn@example.com\r\njane@example.com';
    const result = recipientParserService.parseContent(bomText, 'txt');

    expect(result.validRecipients).toEqual(['john@example.com', 'jane@example.com']);
    expect(result.validCount).toBe(2);
  });

  it('handles CSV with quoted fields containing commas', () => {
    const csvData = [
      'Name,Email',
      '"Doe, John",john.doe@example.com',
      '"Smith, Jane, Jr.",jane.smith@example.com',
      'Simple User,simple@example.com',
    ].join('\n');

    const result = recipientParserService.parseContent(csvData, 'csv');

    expect(result.validRecipients).toEqual([
      'john.doe@example.com',
      'jane.smith@example.com',
      'simple@example.com',
    ]);
    expect(result.validCount).toBe(3);
    expect(result.invalidRows).toHaveLength(0);
  });

  it('deduplicates duplicate emails within the file and reports count', () => {
    const csvData = [
      'Email',
      'duplicate@example.com',
      'other@example.com',
      'DUPLICATE@example.com', // Case-insensitive duplicate
      'other@example.com',
    ].join('\n');

    const result = recipientParserService.parseContent(csvData, 'csv');

    expect(result.validRecipients).toEqual(['duplicate@example.com', 'other@example.com']);
    expect(result.validCount).toBe(2);
    expect(result.duplicatesCount).toBe(2);
  });

  it('records invalid rows with line number and reason without failing valid rows', () => {
    const content = [
      'valid.first@example.com',
      'invalid-email-without-at',
      'valid.second@example.com',
      'bad@domain',
      'valid.third@example.com',
    ].join('\n');

    const result = recipientParserService.parseContent(content, 'txt');

    expect(result.validRecipients).toEqual([
      'valid.first@example.com',
      'valid.second@example.com',
      'valid.third@example.com',
    ]);
    expect(result.validCount).toBe(3);
    expect(result.invalidRows).toHaveLength(2);
    expect(result.invalidRows[0].row).toBe(2);
    expect(result.invalidRows[0].raw).toBe('invalid-email-without-at');
    expect(result.invalidRows[1].row).toBe(4);
  });

  it('parses TXT format with angle-bracketed display names', () => {
    const textData = [
      'Alice Founder <alice@startup.com>',
      'bob@agency.io',
      '"Charlie" <charlie@enterprise.org>',
    ].join('\n');

    const result = recipientParserService.parseContent(textData, 'txt');

    expect(result.validRecipients).toEqual([
      'alice@startup.com',
      'bob@agency.io',
      'charlie@enterprise.org',
    ]);
    expect(result.validCount).toBe(3);
  });
});
