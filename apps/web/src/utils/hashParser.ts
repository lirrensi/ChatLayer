/**
 * Hash parsing utilities for deeplinking functionality
 */

export interface ParsedHash {
    botId?: string;
    userId?: string;
}

/**
 * Parse hash URL to extract botId and username
 * @param hash - The hash part of URL (e.g., "#/bot123/username")
 * @returns ParsedHash object with botId and username
 */
export function parseHash(hash: string): ParsedHash {
    // Remove #/ and trailing slash
    const clean = hash.replace(/^#\/?/, '').replace(/\/$/, '');
    const parts = clean.split('/');

    // Skip 'home' segment if present
    const startIndex = parts[0] === 'home' ? 1 : 0;

    return {
        botId: parts[startIndex] || undefined,
        userId: parts[startIndex + 1] || undefined
    };
}

/**
 * Build hash URL from botId and username
 * @param botId - The bot ID
 * @param username - The username (optional)
 * @returns Hash URL string (e.g., "#/bot123/username")
 */
export function buildHash(botId: string, userId?: string): string {
    const path = userId ? `/home/${botId}/${userId}` : `/home/${botId}`;
    return `#${path}`;
}

/**
 * Validate if a hash string matches the expected deeplink format
 * @param hash - The hash to validate
 * @returns True if hash has valid format
 */
export function isValidDeeplinkHash(hash: string): boolean {
    const clean = hash.replace(/^#\/?/, '').replace(/\/$/, '');
    const parts = clean.split('/');

    // Skip 'home' segment if present
    const startIndex = parts[0] === 'home' ? 1 : 0;
    const relevantParts = parts.slice(startIndex);

    // Must have at least botId
    if (relevantParts.length === 0 || !relevantParts[0]) {
        return false;
    }

    // Optional userId can be present or not
    return relevantParts.length <= 2;
}