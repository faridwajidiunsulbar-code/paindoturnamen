/**
 * Utility functions for validating and sanitizing UUID values.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Check if a value is a valid UUID string.
 */
export function isValidUuid(val: any): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

/**
 * Return valid UUID string, or fallback if valid UUID, or null.
 */
export function toValidUuidOrNull(val: any, fallbackUuid?: string | null): string | null {
  if (isValidUuid(val)) return val.trim();
  if (fallbackUuid && isValidUuid(fallbackUuid)) return fallbackUuid.trim();
  return null;
}

/**
 * Validate that all specified UUID fields in a record or payload are valid UUIDs or null.
 * Returns null if valid, or error message with table and field name if invalid.
 */
export function validateUuidFields(
  tableName: string,
  rows: Record<string, any>[],
  uuidColumns: string[]
): { valid: boolean; error?: string } {
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    for (const col of uuidColumns) {
      const val = row[col];
      if (val !== null && val !== undefined && !isValidUuid(val)) {
        return {
          valid: false,
          error: `Table '${tableName}' column '${col}' received invalid UUID value: "${val}" at index ${idx}. Display names must not be placed in UUID fields.`
        };
      }
    }
  }
  return { valid: true };
}
