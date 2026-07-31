/**
 * SSRF Protection Utility
 * Blocks requests to cloud metadata endpoints
 */

const BLOCKED_METADATA_HOSTS = [
    "169.254.169.254",        // AWS/GCP/Azure metadata
    "metadata.google.internal", // GCP metadata
    "100.100.100.200",        // Alibaba metadata
];

const BLOCKED_IP_RANGES = [
    /^169\.254\.169\.254$/,   // Cloud metadata IP
];

/**
 * Check if a URL points to a blocked metadata endpoint
 * @param url - The URL to check
 * @returns true if URL is blocked, false if allowed
 */
export function isBlockedMetadataUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        
        // Check hostname against blocked list
        if (BLOCKED_METADATA_HOSTS.includes(parsed.hostname)) {
            return true;
        }
        
        // Check against IP patterns
        for (const pattern of BLOCKED_IP_RANGES) {
            if (pattern.test(parsed.hostname)) {
                return true;
            }
        }
        
        return false;
    } catch {
        // Invalid URL - let caller handle
        return false;
    }
}

/**
 * Validate URL for SSRF safety
 * @param url - The URL to validate
 * @returns { valid: boolean, reason?: string }
 */
export function validateUrlForFetch(url: string): { valid: boolean; reason?: string } {
    if (!url) {
        return { valid: false, reason: "URL is required" };
    }
    
    // Must be http or https
    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return { valid: false, reason: "Only http and https protocols are allowed" };
        }
    } catch {
        return { valid: false, reason: "Invalid URL format" };
    }
    
    // Block metadata endpoints
    if (isBlockedMetadataUrl(url)) {
        return { valid: false, reason: "Access to cloud metadata endpoints is blocked" };
    }
    
    return { valid: true };
}
