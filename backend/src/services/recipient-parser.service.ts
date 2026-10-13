import { z } from 'zod';

const emailSchema = z.string().email();

export interface ParseRecipientsResult {
  validRecipients: string[];
  totalParsed: number;
  validCount: number;
  duplicatesCount: number;
  invalidRows: Array<{
    row: number;
    raw: string;
    reason: string;
  }>;
}

export class RecipientParserService {
  private readonly MAX_RECIPIENTS = 10000;
  private readonly MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

  /**
   * Cleans BOM (Byte Order Mark) from file text
   */
  stripBom(content: string): string {
    if (content.charCodeAt(0) === 0xfeff) {
      return content.slice(1);
    }
    return content;
  }

  /**
   * Parses recipient list from raw CSV text, TXT text, or JSON array.
   */
  parseContent(
    rawContent: string,
    format: 'csv' | 'txt' | 'auto' = 'auto'
  ): ParseRecipientsResult {
    const cleanContent = this.stripBom(rawContent);
    const lines = cleanContent.split(/\r?\n/).map((l) => l.trim());

    const validRecipients: string[] = [];
    const seenEmails = new Set<string>();
    let duplicatesCount = 0;
    const invalidRows: Array<{ row: number; raw: string; reason: string }> = [];

    let startLine = 0;
    let isCsv = format === 'csv';

    if (format === 'auto') {
      // Auto-detect format: if line contains comma or quotes, treat as CSV
      const sample = lines.find((l) => l.length > 0) || '';
      isCsv = sample.includes(',') || sample.includes('"');
    }

    // Check for header row in CSV
    if (isCsv && lines.length > 0) {
      const firstLine = lines[0].toLowerCase();
      if (
        firstLine === 'email' ||
        firstLine.startsWith('email,') ||
        firstLine.includes('recipient') ||
        firstLine.startsWith('name,email')
      ) {
        startLine = 1;
      }
    }

    let processedCount = 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue; // Skip blank lines

      processedCount++;
      if (processedCount > this.MAX_RECIPIENTS) {
        invalidRows.push({
          row: i + 1,
          raw: line,
          reason: `Exceeded maximum recipient limit of ${this.MAX_RECIPIENTS}`,
        });
        break;
      }

      let extractedEmail = '';

      if (isCsv) {
        extractedEmail = this.extractEmailFromCsvLine(line);
      } else {
        // TXT: plain email or "Name <email>"
        extractedEmail = this.extractEmailFromTextLine(line);
      }

      if (!extractedEmail) {
        invalidRows.push({
          row: i + 1,
          raw: line,
          reason: 'No valid email found in row',
        });
        continue;
      }

      const normalized = extractedEmail.toLowerCase().trim();
      const validation = emailSchema.safeParse(normalized);

      if (!validation.success) {
        invalidRows.push({
          row: i + 1,
          raw: line,
          reason: 'Malformed email address syntax',
        });
        continue;
      }

      if (seenEmails.has(normalized)) {
        duplicatesCount++;
      } else {
        seenEmails.add(normalized);
        validRecipients.push(normalized);
      }
    }

    return {
      validRecipients,
      totalParsed: processedCount,
      validCount: validRecipients.length,
      duplicatesCount,
      invalidRows,
    };
  }

  /**
   * Extracts email from a CSV row, handling quoted fields containing commas.
   * Example: `"Doe, John",john@example.com` or `john@example.com`
   */
  private extractEmailFromCsvLine(line: string): string {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    fields.push(currentField.trim());

    // Search fields for an email or extract angle-bracketed email
    for (const rawField of fields) {
      const cleanField = rawField.replace(/^"(.*)"$/, '$1').trim();
      const angleMatch = cleanField.match(/<([^>]+)>/);
      const candidate = angleMatch ? angleMatch[1] : cleanField;

      if (emailSchema.safeParse(candidate).success) {
        return candidate;
      }
    }

    // Fallback: check if any part contains an email regex match
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
    const match = line.match(emailRegex);
    return match ? match[1] : '';
  }

  /**
   * Extracts email from plain TXT line, e.g. `john@example.com` or `John Doe <john@example.com>`
   */
  private extractEmailFromTextLine(line: string): string {
    const angleMatch = line.match(/<([^>]+)>/);
    if (angleMatch) {
      return angleMatch[1].trim();
    }
    return line.trim();
  }
}

export const recipientParserService = new RecipientParserService();
