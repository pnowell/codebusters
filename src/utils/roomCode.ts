/**
 * Room code utilities for shared puzzle seeds (Friend Codes).
 * Generates and parses short, human-readable codes like "ATB-142".
 */

export class LocalPairCoordinator {
  static createRoomCode(cipher: string, quoteId: number): string {
    const prefix = cipher.substring(0, 3).toUpperCase();
    const seed = (quoteId + 100).toString(36).toUpperCase();
    return `${prefix}-${seed}`;
  }

  static decodeRoomCode(code: string): { cipherPrefix: string; quoteId: number } | null {
    const parts = code.trim().split('-');
    if (parts.length !== 2) return null;
    const quoteId = parseInt(parts[1], 36) - 100;
    return { cipherPrefix: parts[0], quoteId };
  }
}
