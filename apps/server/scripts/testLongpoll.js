/**
 * Simple test script to exercise the ChatLayer server longpoll + addMessage endpoints.
 *
 * Usage:
 *   node scripts/testLongpoll.js
 *
 * Adjust HOST and API_KEY as needed (matches [`config/server.json`](config/server.json:1)).
 */

const HOST = process.env.HOST || "http://localhost:3000";
const API_KEY = process.env.API_KEY || "dev-key-123";

async function addMessage(botId, roomId, userId, text) {
    const res = await fetch(`${HOST}/addMessage`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": API_KEY,
        },
        body: JSON.stringify({ botId, roomId, userId, text }),
    });
    return res.json();
}

async function waitForUpdates(botId, roomId, timeoutMs = 30000) {
    const url = new URL(`${HOST}/getUpdates`);
    url.searchParams.set("botId", botId);
    if (roomId) url.searchParams.set("roomId", roomId);
    url.searchParams.set("timeoutMs", String(timeoutMs));
    url.searchParams.set("apiKey", API_KEY);

    const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
            accept: "application/json",
        },
    });
    return res.json();
}

(async () => {
    const botId = "test-bot";
    const roomId = "room-1";
    const userId = "user-1";

    console.log("Starting longpoll waiter (will wait ~20s)...");
    const waiter = waitForUpdates(botId, roomId, 20000)
        .then(msgs => {
            console.log("Longpoll returned:", msgs);
        })
        .catch(err => {
            console.error("Longpoll error", err);
        });

    // Give the waiter a moment then send a message
    setTimeout(async () => {
        console.log("Sending message to /addMessage ...");
        const added = await addMessage(botId, roomId, userId, "Hello from test script");
        console.log("Message added:", added);
    }, 1500);

    await waiter;
    console.log("Done.");
})();
