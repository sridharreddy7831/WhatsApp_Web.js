const express = require("express");
const { MessageMedia } = require("whatsapp-web.js");
const SessionManager = require("./sessionManager");

const router = express.Router();

function formatPhone(phone) {
    let finalNumber = String(phone).replace(/\D/g, "");
    if (!finalNumber.startsWith("91") && finalNumber.length === 10) {
        finalNumber = "91" + finalNumber;
    }
    return finalNumber + "@c.us";
}

// Middleware to inject session using the :sessionId param
router.use("/whatsapp/:sessionId", (req, res, next) => {
    const session = SessionManager.getSession(req.params.sessionId);
    req.sessionData = session;
    next();
});

// 1. boot / start session
router.all("/whatsapp/:sessionId/start", async (req, res) => {
    const { sessionId } = req.params;
    const session = SessionManager.getSession(sessionId);
    if (session) {
        return res.json({ success: true, message: `Session ${sessionId} is already active`, status: session.status });
    }
    await SessionManager.createSession(sessionId);
    res.json({ success: true, message: `Session ${sessionId} initializing...` });
});

// 2. getStatus
router.get("/whatsapp/:sessionId/status", (req, res) => {
    if (!req.sessionData) return res.status(404).json({ error: "Session not found. Calling /start first." });

    res.json({
        sessionId: req.sessionData.id,
        ready: req.sessionData.ready,
        status: req.sessionData.status,
    });
});

// 3. getQr
router.get("/whatsapp/:sessionId/qr", (req, res) => {
    if (!req.sessionData) return res.status(404).json({ error: "Session not found." });

    res.json({
        sessionId: req.sessionData.id,
        qrDataUrl: req.sessionData.qr,
        hasQr: !!req.sessionData.qr,
        ready: req.sessionData.ready,
        status: req.sessionData.status
    });
});

// 4. send(data) - text messages
router.post("/whatsapp/:sessionId/send", async (req, res) => {
    if (!req.sessionData) return res.status(404).json({ error: "Session not found." });
    if (!req.sessionData.ready) return res.status(503).json({ error: "WhatsApp not connected" });

    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "Missing phone or message" });

    try {
        const targetNumber = formatPhone(phone);
        const isRegistered = await req.sessionData.client.isRegisteredUser(targetNumber);

        if (!isRegistered) {
            return res.status(400).json({ error: "Number not registered on WhatsApp" });
        }

        const response = await req.sessionData.client.sendMessage(targetNumber, message);
        res.json({ success: true, messageId: response.id._serialized });
    } catch (error) {
        console.error("SEND ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// 5. sendReceipt(to, receipt) - media/docs
router.post("/whatsapp/:sessionId/send-receipt", async (req, res) => {
    if (!req.sessionData) return res.status(404).json({ error: "Session not found." });
    if (!req.sessionData.ready) return res.status(503).json({ error: "WhatsApp not connected" });

    const { phone, base64Data, mimetype, filename, caption } = req.body;

    if (!phone || !base64Data) {
        return res.status(400).json({ error: "Missing phone or base64Data" });
    }

    try {
        const targetNumber = formatPhone(phone);
        const isRegistered = await req.sessionData.client.isRegisteredUser(targetNumber);
        if (!isRegistered) return res.status(400).json({ error: "Number not registered on WhatsApp" });

        const pureBase64 = base64Data.includes("base64,") ? base64Data.split("base64,")[1] : base64Data;
        const mt = mimetype || "application/pdf";
        const fn = filename || "receipt.pdf";

        const media = new MessageMedia(mt, pureBase64, fn);
        const sendOptions = caption ? { caption } : {};

        const response = await req.sessionData.client.sendMessage(targetNumber, media, sendOptions);
        res.json({ success: true, messageId: response.id._serialized });
    } catch (error) {
        console.error("SEND RECEIPT ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// 6. sendBulk(messages[])
router.post("/whatsapp/:sessionId/send-bulk", async (req, res) => {
    if (!req.sessionData) return res.status(404).json({ error: "Session not found." });
    if (!req.sessionData.ready) return res.status(503).json({ error: "WhatsApp not connected" });

    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages array is required" });
    }

    res.json({ success: true, status: "Processing in background", total: messages.length });

    const client = req.sessionData.client;
    (async () => {
        for (const item of messages) {
            try {
                if (!item.phone || !item.message) continue;
                const targetNumber = formatPhone(item.phone);

                const randomDelay = Math.floor(Math.random() * 3000) + 2000;
                await new Promise(resolve => setTimeout(resolve, randomDelay));

                const isRegistered = await client.isRegisteredUser(targetNumber);
                if (isRegistered) {
                    await client.sendMessage(targetNumber, item.message);
                }
            } catch (err) { }
        }
    })();
});

// 7. getMessages(params?)
router.get("/whatsapp/:sessionId/messages", async (req, res) => {
    if (!req.sessionData) return res.status(404).json({ error: "Session not found." });
    if (!req.sessionData.ready) return res.status(503).json({ error: "WhatsApp not connected" });

    const { phone, limit } = req.query;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    try {
        const targetNumber = formatPhone(phone);
        const chat = await req.sessionData.client.getChatById(targetNumber);

        const fetchLimit = parseInt(limit) || 20;
        const messages = await chat.fetchMessages({ limit: fetchLimit });

        const cleanedMessages = messages.map(m => ({
            id: m.id._serialized,
            body: m.body,
            fromMe: m.fromMe,
            type: m.type,
            timestamp: m.timestamp,
            hasMedia: m.hasMedia
        }));

        res.json({ success: true, messages: cleanedMessages });
    } catch (error) {
        console.error("GET MESSAGES ERROR:", error);
        res.status(500).json({ error: error.message || "Failed to fetch messages or chat does not exist" });
    }
});

// 8. requestPairingCode(phone)
router.post("/whatsapp/:sessionId/pair", async (req, res) => {
    if (!req.sessionData) return res.status(404).json({ error: "Session not found. Call /start first." });
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    try {
        if (req.sessionData.ready) {
            return res.status(400).json({ error: "WhatsApp is already connected." });
        }
        const code = await req.sessionData.client.requestPairingCode(String(phone).replace(/\D/g, ""));
        res.json({ success: true, pairingCode: code });
    } catch (error) {
        console.error("PAIRING ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// 9. logout()
router.post("/whatsapp/:sessionId/logout", async (req, res) => {
    const { sessionId } = req.params;
    if (!req.sessionData) return res.status(404).json({ error: "Session not found." });

    try {
        await SessionManager.deleteSession(sessionId);
        res.json({ success: true, message: `Session ${sessionId} logged out and deleted completely` });
    } catch (error) {
        console.error("LOGOUT ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// 10. restart()
router.post("/whatsapp/:sessionId/restart", async (req, res) => {
    const { sessionId } = req.params;
    if (!req.sessionData) return res.status(404).json({ error: "Session not found." });

    res.json({ success: true, message: `Restarting session ${sessionId}...` });

    setTimeout(async () => {
        await SessionManager.deleteSession(sessionId);
        SessionManager.createSession(sessionId);
    }, 1000);
});

module.exports = router;
