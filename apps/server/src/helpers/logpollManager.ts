/**
 * Long poll manager (reworked)
 *
 * Now supports listener roles (listenerType: "bot" | "ui") and listening
 * for multiple botIds at once. A listener may provide an array of botIds
 * that it is interested in; an empty array or missing botIds means "all bots"
 * (used by UI listeners).
 *
 * API:
 *  - longPoll.waitForMessages(botIds?, timeoutMs?, listenerType?)
 *  - longPoll.notifyListeners(messages[], listenerType?)
 */

export type Message = {
    id?: number;
    botId: string;
    roomId?: string | null;
    userId: string;
    messageType?: string;
    text?: string;
    attachments?: any;
    meta?: any;
    createdAt?: string | Date;
};

type ListenerType = "bot" | "ui";

type Listener = {
    botIds?: string[] | null; // null or undefined => listen to all bots
    listenerType: ListenerType;
    resolve: (messages: Message[]) => void;
    timeout: NodeJS.Timeout;
};

class LongPollManager {
    // map listeners by listenerType for simple routing
    private listeners: Map<ListenerType, Listener[]> = new Map();

    constructor() {
        this.listeners.set("bot", []);
        this.listeners.set("ui", []);
    }

    /**
     * waitForMessages
     * - botIds: optional array of botIds to listen for. If omitted or empty => listen to all bots.
     * - timeoutMs: how long to wait before returning empty array
     * - listenerType: "bot" or "ui" (defaults to "bot" for backward compatibility)
     */
    async waitForMessages(
        botIds?: string[] | null,
        timeoutMs = 30000,
        listenerType: ListenerType = "bot",
    ): Promise<Message[]> {
        return new Promise(resolve => {
            const timeout = setTimeout(() => {
                this.removeListener(resolve, listenerType);
                resolve([]); // timeout, return empty
            }, timeoutMs);

            const listener: Listener = {
                botIds: botIds && botIds.length > 0 ? botIds : null,
                listenerType,
                resolve,
                timeout,
            };
            const list = this.listeners.get(listenerType)!;
            list.push(listener);
        });
    }

    /**
     * notifyListeners
     * - messages: array of incoming messages to distribute
     * - listenerType: only notify listeners of this role (bot|ui)
     *
     * For each listener we filter messages to the botIds they requested (unless they requested all)
     * and resolve only if there are one or more messages matching that listener.
     * Resolved listeners are removed.
     */
    notifyListeners(messages: Message[], listenerType: ListenerType = "bot") {
        const list = this.listeners.get(listenerType) || [];
        const remaining: Listener[] = [];

        for (const listener of list) {
            try {
                const interested =
                    listener.botIds && listener.botIds.length > 0
                        ? messages.filter(m => listener.botIds!.includes(m.botId))
                        : messages.slice(); // listener wants all bots -> give all messages

                if (interested.length > 0) {
                    clearTimeout(listener.timeout);
                    try {
                        listener.resolve(interested);
                    } catch (e) {
                        // swallow listener errors
                    }
                } else {
                    // keep the listener waiting
                    remaining.push(listener);
                }
            } catch (e) {
                // on error, drop the listener
                clearTimeout(listener.timeout);
            }
        }

        this.listeners.set(listenerType, remaining);
    }

    private removeListener(resolve: Function, listenerType: ListenerType) {
        const list = this.listeners.get(listenerType) || [];
        this.listeners.set(
            listenerType,
            list.filter(l => l.resolve !== resolve),
        );
    }
}

export const longPoll = new LongPollManager();
