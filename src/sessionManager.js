const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");

const sessions = new Map();

class SessionManager {
    static getSession(id) {
        return sessions.get(id);
    }

    static async createSession(id) {
        if (sessions.has(id)) return sessions.get(id);

        const sessionData = {
            id,
            client: null,
            qr: "",
            ready: false,
            status: "initializing",
            reconnectAttempts: 0
        };
        sessions.set(id, sessionData);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: id }),
            puppeteer: {
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ]
            }
        });
        sessionData.client = client;

        client.on("qr", async (qr) => {
            sessionData.qr = await qrcode.toDataURL(qr);
            sessionData.status = "connecting (waiting for scan or pairing code)";
            sessionData.ready = false;
            console.log(`[${id}] QR Generated`);
        });

        client.on("ready", () => {
            sessionData.ready = true;
            sessionData.qr = "";
            sessionData.status = "connected";
            sessionData.reconnectAttempts = 0;
            console.log(`[${id}] Connected \u2705`);
        });

        client.on("disconnected", (reason) => {
            sessionData.ready = false;
            sessionData.qr = "";
            sessionData.status = "disconnected";
            console.log(`[${id}] Disconnected \u274c Reason:`, reason);
        });

        client.on("auth_failure", (msg) => {
            sessionData.ready = false;
            sessionData.status = "auth_failure";
            console.log(`[${id}] Auth Failure:`, msg);
        });

        try {
            await client.initialize();
        } catch (err) {
            console.error(`[${id}] Init error:`, err.message);
            sessionData.status = "init_error";
        }

        return sessionData;
    }

    static async deleteSession(id) {
        const session = sessions.get(id);
        if (session && session.client) {
            try { await session.client.logout(); } catch (e) { }
            try { await session.client.destroy(); } catch (e) { }
        }
        sessions.delete(id);

        // Remove local auth folder for this client
        const authPath = path.join(process.cwd(), `.wwebjs_auth/session-${id}`);
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
    }

    static async clearAllSessions() {
        const ids = Array.from(sessions.keys());
        for (const id of ids) {
            await this.deleteSession(id);
        }

        // As a fallback, wipe the entire base auth folder entirely
        const baseAuthPath = path.join(process.cwd(), `.wwebjs_auth`);
        if (fs.existsSync(baseAuthPath)) {
            fs.rmSync(baseAuthPath, { recursive: true, force: true });
        }
        console.log("All WhatsApp sessions have been completely wiped.");
    }
}

module.exports = SessionManager;
