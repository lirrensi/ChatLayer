/**
 * Notification Manager
 * Handles browser notifications with permission management and debouncing
 */

// Type for notification options
export interface NotificationOptions {
    title: string;
    body?: string;
    icon?: string;
    tag?: string;
}

class NotificationManager {
    private isSupported: boolean = false;
    private permission: NotificationPermission = 'default';
    private lastNotificationTime: number = 0;
    private readonly DEBOUNCE_MS: number = 20000; // 20 seconds debounce
    private pendingNotification: NotificationOptions | null = null;
    private debounceTimer: number | null = null;

    constructor() {
        this.checkSupport();
        this.requestPermission();
    }

    /**
     * Check if browser notifications are supported
     */
    private checkSupport(): void {
        this.isSupported = 'Notification' in window;
        if (!this.isSupported) {
            console.warn('[NotificationManager] Browser notifications are not supported');
        }
    }

    /**
     * Request notification permission from the user
     */
    async requestPermission(): Promise<NotificationPermission> {
        if (!this.isSupported) {
            return 'denied';
        }

        if (this.permission !== 'default') {
            return this.permission;
        }

        try {
            this.permission = await Notification.requestPermission();
            console.log(`[NotificationManager] Permission granted: ${this.permission}`);
            return this.permission;
        } catch (error) {
            console.error('[NotificationManager] Error requesting permission:', error);
            this.permission = 'denied';
            return 'denied';
        }
    }

    /**
     * Check if notifications are enabled
     */
    isEnabled(): boolean {
        return this.isSupported && this.permission === 'granted';
    }

    /**
     * Show a notification with debouncing
     * @param options Notification options
     * @param force If true, bypass debounce (useful for important notifications)
     */
    async showNotification(options: NotificationOptions, force: boolean = false): Promise<void> {
        if (!this.isEnabled()) {
            console.log('[NotificationManager] Notifications not enabled, skipping');
            return;
        }
    
        // Suppress push notifications when window is visible and focused
        try {
            if (typeof document !== 'undefined' && !document.hidden) {
                const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
                if (hasFocus) {
                    console.log('[NotificationManager] Window focused - suppressing push notification');
                    return;
                }
            }
        } catch (visibilityErr) {
            // Non-fatal: continue with normal flow
        }
    
        const now = Date.now();
        const timeSinceLastNotification = now - this.lastNotificationTime;
    
        // If we should show this notification immediately (force or enough time passed)
        if (force || timeSinceLastNotification >= this.DEBOUNCE_MS) {
            this._showNotificationNow(options);
            this.lastNotificationTime = now;
            this.pendingNotification = null;
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
        } else {
            // Store the latest notification and wait for debounce period
            this.pendingNotification = options;
            
            // If we don't have a timer running, start one
            if (!this.debounceTimer) {
                const remainingTime = this.DEBOUNCE_MS - timeSinceLastNotification;
                this.debounceTimer = setTimeout(() => {
                    if (this.pendingNotification) {
                        this._showNotificationNow(this.pendingNotification);
                        this.lastNotificationTime = Date.now();
                        this.pendingNotification = null;
                    }
                    this.debounceTimer = null;
                }, remainingTime) as unknown as number;
            }
        }
    }

    /**
     * Immediately show a notification without debouncing
     * @param options Notification options
     */
    private _showNotificationNow(options: NotificationOptions): void {
        try {
            const notification = new Notification(options.title, {
                body: options.body,
                icon: options.icon || '/favicon.png',
                tag: options.tag || 'botoraptor-notification'
            });

            // Auto-close notification after 5 seconds
            setTimeout(() => {
                notification.close();
            }, 5000);

            console.log('[NotificationManager] Notification shown:', options.title);
        } catch (error) {
            console.error('[NotificationManager] Error showing notification:', error);
        }
    }

    /**
     * Clear any pending notification
     */
    clearPendingNotification(): void {
        this.pendingNotification = null;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}

// Create and export singleton instance
export const notificationManager = new NotificationManager();
