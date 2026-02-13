const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(cookieParser());

// ========== Mobile Auth — Multi-Session OTP System ==========

// In-memory stores
const otpStore = new Map();       // phone -> { otp, expiresAt, attempts }
const sessionStore = new Map();   // sessionToken -> { phone, createdAt, lastAccess }
const SESSION_COOKIE = "wbm_session";
const OTP_EXPIRY_MS = 5 * 60 * 1000;   // 5 minutes
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_OTP_ATTEMPTS = 5;

// Generate a secure random session token
function generateSessionToken() {
    return crypto.randomBytes(32).toString("hex");
}

// Generate a random 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Clean up expired OTPs and sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [phone, data] of otpStore) {
        if (now > data.expiresAt) otpStore.delete(phone);
    }
    for (const [token, session] of sessionStore) {
        if (now - session.lastAccess > SESSION_EXPIRY_MS) sessionStore.delete(token);
    }
}, 60 * 1000); // every minute

// Auth middleware — DISABLED as per user request (public access)
function authMiddleware(req, res, next) {
    next();
}

// Apply auth middleware BEFORE static files for HTML pages
// Serve login.html without auth
app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Auth API routes (no auth needed)
// Send OTP
app.post("/auth/send-otp", async (req, res) => {
    const { phone, type } = req.body;

    // Validate phone
    if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ error: "Please enter a valid 10-digit Indian mobile number." });
    }

    // Rate limit: max one OTP per phone every 30 seconds
    const existing = otpStore.get(phone);
    if (existing && (Date.now() - (existing.createdAt || 0)) < 30000) {
        return res.status(429).json({ error: "Please wait 30 seconds before requesting a new OTP." });
    }

    // Check WhatsApp connection
    if (!isReady || !client) {
        return res.status(503).json({ error: "WhatsApp is not connected. Please connect WhatsApp first from the dashboard." });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    // Store OTP
    otpStore.set(phone, {
        otp,
        expiresAt,
        attempts: 0,
        createdAt: Date.now(),
        type: type || "login"
    });

    // Send OTP via WhatsApp
    try {
        let finalNumber = phone;
        if (!finalNumber.startsWith("91")) {
            finalNumber = "91" + finalNumber;
        }
        const number = finalNumber + "@c.us";

        const isRegistered = await client.isRegisteredUser(number);
        if (!isRegistered) {
            otpStore.delete(phone);
            return res.status(400).json({ error: "This number is not registered on WhatsApp." });
        }

        const actionText = type === "signup" ? "Sign Up" : "Login";
        const message = `🔐 *Verification Code*\n\n` +
            `Your verification code is: *${otp}*\n\n` +
            `This code will expire in 5 minutes.\n` +
            `If you didn't request this, please ignore this message.\n\n` +
            `-- Thank you for using this Whatsapp Otp Sender (NSR)`;

        await client.sendMessage(number, message);

        console.log(`📱 OTP sent to ${phone} for ${actionText}: ${otp}`);
        res.json({ success: true, message: `OTP sent to +91 ${phone} via WhatsApp` });

    } catch (err) {
        console.error("OTP SEND ERROR:", err);
        otpStore.delete(phone);
        res.status(500).json({ error: "Failed to send OTP via WhatsApp. Please try again." });
    }
});

// Verify OTP
app.post("/auth/verify-otp", (req, res) => {
    const { phone, otp, type } = req.body;

    if (!phone || !otp) {
        return res.status(400).json({ error: "Phone number and OTP are required." });
    }

    const stored = otpStore.get(phone);
    if (!stored) {
        return res.status(400).json({ error: "No OTP found. Please request a new OTP." });
    }

    // Check expiry
    if (Date.now() > stored.expiresAt) {
        otpStore.delete(phone);
        return res.status(400).json({ error: "OTP has expired. Please request a new one." });
    }

    // Check attempts
    stored.attempts++;
    if (stored.attempts > MAX_OTP_ATTEMPTS) {
        otpStore.delete(phone);
        return res.status(400).json({ error: "Too many wrong attempts. Please request a new OTP." });
    }

    // Verify
    if (otp !== stored.otp) {
        return res.status(400).json({
            error: `Invalid OTP. ${MAX_OTP_ATTEMPTS - stored.attempts} attempts remaining.`
        });
    }

    // OTP is correct — create session
    otpStore.delete(phone);

    // Create a new session token for this phone
    // This allows multiple phones to be logged in simultaneously on different browsers/devices
    const sessionToken = generateSessionToken();
    sessionStore.set(sessionToken, {
        phone,
        createdAt: Date.now(),
        lastAccess: Date.now(),
        type: type || "login"
    });

    // Set session cookie
    res.cookie(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        maxAge: SESSION_EXPIRY_MS,
        sameSite: "lax",
        path: "/"
    });

    const actionText = type === "signup" ? "Account created" : "Logged in";
    console.log(`✅ ${actionText} successfully: ${phone} (token: ${sessionToken.slice(0, 8)}...)`);
    res.json({
        success: true,
        message: `${actionText} successfully!`,
        phone
    });
});

// Check session
app.get("/auth/session", (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token || !sessionStore.has(token)) {
        return res.json({ loggedIn: false });
    }

    const session = sessionStore.get(token);
    // Check expiry
    if (Date.now() - session.lastAccess > SESSION_EXPIRY_MS) {
        sessionStore.delete(token);
        res.clearCookie(SESSION_COOKIE);
        return res.json({ loggedIn: false });
    }

    session.lastAccess = Date.now();
    res.json({ loggedIn: true, phone: session.phone });
});

// Logout
app.post("/auth/logout", (req, res) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
        const session = sessionStore.get(token);
        if (session) {
            console.log(`🚪 Logged out: ${session.phone}`);
        }
        sessionStore.delete(token);
    }
    res.clearCookie(SESSION_COOKIE);
    res.json({ success: true, message: "Logged out successfully" });
});

// Active sessions info (admin/debug)
app.get("/auth/active-sessions", (req, res) => {
    const sessions = [];
    for (const [token, session] of sessionStore) {
        sessions.push({
            phone: session.phone,
            createdAt: new Date(session.createdAt).toISOString(),
            lastAccess: new Date(session.lastAccess).toISOString(),
            tokenPreview: token.slice(0, 8) + "..."
        });
    }
    res.json({ activeSessions: sessions.length, sessions });
});

// Apply auth middleware for all routes below
app.use(authMiddleware);

// Serve static files after auth middleware
app.use(express.static("public"));

// Multer config for logo upload (memory storage → Base64)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new Error("Only image files allowed"), false);
    }
});

// ========== WhatsApp Client ==========

let qrCodeData = "";
let isReady = false;
let client;
let manualDisconnect = false;
let connectionStatus = "initializing";
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
const BASE_RECONNECT_DELAY = 5000;

function getReconnectDelay() {
    return Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
}

function clearAuthSession() {
    const authPath = path.join(__dirname, ".wwebjs_auth");
    if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log("Auth session cache cleared");
    }
}

function initializeWhatsApp() {
    connectionStatus = "connecting";
    qrCodeData = "";
    isReady = false;

    // Destroy any existing client to prevent orphaned browser processes
    if (client) {
        try { client.destroy(); } catch (e) { }
        client = null;
    }

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false,
        }
    });

    client.on("qr", async (qr) => {
        qrCodeData = await qrcode.toDataURL(qr);
        connectionStatus = "connecting";
        reconnectAttempts = 0;
        console.log("QR Generated");
    });

    client.on("ready", () => {
        isReady = true;
        qrCodeData = "";
        connectionStatus = "connected";
        reconnectAttempts = 0;
        console.log("WhatsApp Connected ✅");
    });

    client.on("disconnected", (reason) => {
        isReady = false;
        qrCodeData = "";
        console.log("WhatsApp Disconnected ❌ Reason:", reason);
        if (!manualDisconnect) {
            autoReconnect("disconnected");
        } else {
            connectionStatus = "disconnected";
        }
    });

    client.on("auth_failure", (message) => {
        isReady = false;
        qrCodeData = "";
        console.log("WhatsApp Auth Failure ❌:", message);
        clearAuthSession();
        autoReconnect("auth_failure");
    });

    client.on("change_state", (state) => {
        console.log("WhatsApp State Changed:", state);
        if (state === "CONFLICT" || state === "UNLAUNCHED" || state === "UNPAIRED") {
            if (!manualDisconnect) {
                isReady = false;
                autoReconnect("state_" + state);
            }
        }
    });

    client.initialize().catch((err) => {
        console.error("WhatsApp initialization failed:", err.message);
        if (!manualDisconnect) {
            autoReconnect("init_error");
        }
    });
}

function autoReconnect(reason) {
    reconnectAttempts++;
    const delay = getReconnectDelay();
    connectionStatus = "reconnecting";
    console.log(`🔄 Auto-reconnecting (attempt ${reconnectAttempts}) in ${delay / 1000}s... Reason: ${reason}`);

    setTimeout(async () => {
        try {
            if (client) {
                try { await client.destroy(); } catch (e) { }
            }
            console.log(`🔄 Reconnecting now (attempt ${reconnectAttempts})...`);
            initializeWhatsApp();
        } catch (err) {
            console.error("Reconnect failed:", err.message);
            if (!manualDisconnect) {
                autoReconnect("reconnect_error");
            }
        }
    }, delay);
}

initializeWhatsApp();

// ========== Data Files ==========

const BILLS_FILE = path.join(__dirname, "bills.json");
const SHOP_SETTINGS_FILE = path.join(__dirname, "shop-settings.json");

function loadBillsData() {
    try {
        if (fs.existsSync(BILLS_FILE)) {
            return JSON.parse(fs.readFileSync(BILLS_FILE, "utf-8"));
        }
    } catch (e) {
        console.error("Error loading bills:", e.message);
    }
    return [];
}

function saveBillsData(bills) {
    fs.writeFileSync(BILLS_FILE, JSON.stringify(bills, null, 2), "utf-8");
}

function loadShopSettings() {
    const defaults = {
        shopName: "", address: "", gstNumber: "", phone: "", email: "",
        logoUrl: "", logoBase64: "", upiId: "",
        website: "", dlNumber: "", contactPerson: "",
        bankDetails: {
            accountHolder: "", bankName: "",
            accountNumber: "", branch: "", ifscCode: ""
        }
    };
    try {
        if (fs.existsSync(SHOP_SETTINGS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(SHOP_SETTINGS_FILE, "utf-8"));
            return { ...defaults, ...saved, bankDetails: { ...defaults.bankDetails, ...(saved.bankDetails || {}) } };
        }
    } catch (e) {
        console.error("Error loading shop settings:", e.message);
    }
    return defaults;
}

function saveShopSettings(settings) {
    fs.writeFileSync(SHOP_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

// ========== API Key Management ==========

// crypto already imported at top
const API_KEYS_FILE = path.join(__dirname, "api-keys.json");

function loadApiKeys() {
    try {
        if (fs.existsSync(API_KEYS_FILE)) {
            return JSON.parse(fs.readFileSync(API_KEYS_FILE, "utf-8"));
        }
    } catch (e) {
        console.error("Error loading API keys:", e.message);
    }
    return [];
}

function saveApiKeys(keys) {
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2), "utf-8");
}

function generateApiKey(name) {
    const key = "nxr_live_" + crypto.randomBytes(24).toString("hex");
    const entry = {
        key,
        name: name || "Unnamed App",
        createdAt: new Date().toISOString(),
        active: true,
        rateLimit: 100, // requests per hour
        usage: {
            today: 0,
            total: 0,
            lastReset: new Date().toISOString().split("T")[0]
        }
    };
    const keys = loadApiKeys();
    keys.push(entry);
    saveApiKeys(keys);
    return entry;
}

// Auth middleware — validates X-API-Key header
function apiAuth(req, res, next) {
    const apiKey = req.headers["x-api-key"] || req.query.api_key;

    if (!apiKey) {
        return res.status(401).json({
            error: "Missing API key",
            message: "Provide your API key via X-API-Key header or ?api_key= query parameter",
            docs: "/api/docs"
        });
    }

    const keys = loadApiKeys();
    const keyEntry = keys.find(k => k.key === apiKey);

    if (!keyEntry) {
        return res.status(401).json({ error: "Invalid API key" });
    }

    if (!keyEntry.active) {
        return res.status(403).json({ error: "API key has been revoked" });
    }

    // Track usage
    const today = new Date().toISOString().split("T")[0];
    if (keyEntry.usage.lastReset !== today) {
        keyEntry.usage.today = 0;
        keyEntry.usage.lastReset = today;
    }
    keyEntry.usage.today++;
    keyEntry.usage.total++;
    saveApiKeys(keys);

    req.apiKeyEntry = keyEntry;
    next();
}

// Rate limit middleware — per-key hourly limit
const rateLimitMap = new Map(); // key -> { count, resetTime }

function apiRateLimit(req, res, next) {
    const keyEntry = req.apiKeyEntry;
    const limit = keyEntry.rateLimit || 100;
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour

    let bucket = rateLimitMap.get(keyEntry.key);
    if (!bucket || now > bucket.resetTime) {
        bucket = { count: 0, resetTime: now + windowMs };
        rateLimitMap.set(keyEntry.key, bucket);
    }

    bucket.count++;

    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - bucket.count));
    res.setHeader("X-RateLimit-Reset", new Date(bucket.resetTime).toISOString());

    if (bucket.count > limit) {
        return res.status(429).json({
            error: "Rate limit exceeded",
            limit,
            retryAfter: Math.ceil((bucket.resetTime - now) / 1000) + "s"
        });
    }

    next();
}

function generateInvoiceNumber() {
    const now = new Date();
    const y = now.getFullYear().toString().slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
    return `INV-${y}${m}${d}-${rand}`;
}

// ========== Number to Words (Indian format) ==========

function numberToWords(num) {
    if (num === 0) return "Zero Only";
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    function convert(n) {
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
        if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + convert(n % 100) : "");
        if (n < 100000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + convert(n % 1000) : "");
        if (n < 10000000) return convert(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + convert(n % 100000) : "");
        return convert(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + convert(n % 10000000) : "");
    }

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);
    let result = "Rupees " + convert(rupees);
    if (paise > 0) result += " and " + convert(paise) + " Paise";
    result += " Only";
    return result;
}

// ========== GST Calculation ==========

function calculateGST(items) {
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    const processedItems = items.map(item => {
        const qty = parseInt(item.qty) || 0;
        const price = parseFloat(item.price) || 0;
        const gstPercent = parseFloat(item.gstPercent) || 0;
        const baseAmount = qty * price;
        const gstAmount = (baseAmount * gstPercent) / 100;
        const cgst = gstAmount / 2;
        const sgst = gstAmount / 2;
        const total = baseAmount + gstAmount;

        subtotal += baseAmount;
        totalCgst += cgst;
        totalSgst += sgst;

        return {
            name: item.name,
            hsnSac: item.hsnSac || "",
            qty,
            uom: item.uom || "NOS",
            price,
            gstPercent,
            taxableValue: parseFloat(baseAmount.toFixed(2)),
            gstAmount: parseFloat(gstAmount.toFixed(2)),
            cgst: parseFloat(cgst.toFixed(2)),
            sgst: parseFloat(sgst.toFixed(2)),
            total: parseFloat(total.toFixed(2))
        };
    });

    return {
        items: processedItems,
        subtotal: parseFloat(subtotal.toFixed(2)),
        totalCgst: parseFloat(totalCgst.toFixed(2)),
        totalSgst: parseFloat(totalSgst.toFixed(2)),
        totalGst: parseFloat((totalCgst + totalSgst).toFixed(2)),
        grandTotal: parseFloat((subtotal + totalCgst + totalSgst).toFixed(2))
    };
}

// ========== Image URL Helper ==========

function fetchImageBuffer(url, timeout = 8000) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith("https") ? https : http;
        const timer = setTimeout(() => reject(new Error("Image fetch timeout")), timeout);

        protocol.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                clearTimeout(timer);
                return fetchImageBuffer(res.headers.location, timeout).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                clearTimeout(timer);
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => {
                clearTimeout(timer);
                resolve(Buffer.concat(chunks));
            });
            res.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
        }).on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

// ========== Helper: Load logo buffer ==========
async function getLogoBuffer(shopSettings) {
    // Try Base64 first, then URL
    if (shopSettings.logoBase64) {
        try {
            const matches = shopSettings.logoBase64.match(/^data:image\/\w+;base64,(.+)$/);
            if (matches) return Buffer.from(matches[1], "base64");
            return Buffer.from(shopSettings.logoBase64, "base64");
        } catch (e) { console.log("Base64 logo decode failed:", e.message); }
    }
    if (shopSettings.logoUrl) {
        try { return await fetchImageBuffer(shopSettings.logoUrl); }
        catch (e) { console.log("Logo URL fetch failed:", e.message); }
    }
    return null;
}

// ========== A4 PDF — GST Tax Invoice (Modern Unique Design) ==========

function generateA4PDFBuffer(bill, shopSettings) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 40 });
            const chunks = [];
            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const pageW = doc.page.width;
            const pageH = doc.page.height;
            const pw = pageW - 80; // usable width
            const lm = 40; // left margin
            const rm = lm + pw; // right edge
            let y = 0;

            // ── Color Palette ──
            const navy = "#0f2b46";
            const teal = "#1a7a6d";
            const slate = "#3d5a73";
            const dark = "#222222";
            const gray = "#555555";
            const midGray = "#888888";
            const light = "#c0c8d0";
            const rowEven = "#f5f8fa";
            const headerBg = "#0f2b46";

            // ── TOP ACCENT BAR ──
            doc.rect(0, 0, pageW, 6).fill(teal);
            y = 20;

            // ── COMPANY BRANDING (LEFT) ──
            const logoBuffer = await getLogoBuffer(shopSettings);
            let logoRight = lm;
            if (logoBuffer) {
                try {
                    doc.image(logoBuffer, lm, y, { width: 50, height: 50 });
                    logoRight = lm + 60;
                } catch (e) { console.log("Logo render failed:", e.message); }
            }

            if (shopSettings.shopName) {
                doc.fontSize(18).font("Helvetica-Bold").fillColor(navy)
                    .text(shopSettings.shopName, logoRight, y, { width: pw * 0.55 });
            }
            let sy = y + 22;
            doc.fontSize(7.5).font("Helvetica").fillColor(gray);
            if (shopSettings.address) { doc.text(shopSettings.address, logoRight, sy, { width: pw * 0.5 }); sy += 10; }
            if (shopSettings.phone) { doc.text(`Phone: +91 ${shopSettings.phone}`, logoRight, sy); sy += 9; }
            if (shopSettings.email) { doc.text(`Email: ${shopSettings.email}`, logoRight, sy); sy += 9; }
            if (shopSettings.gstNumber) {
                doc.font("Helvetica-Bold").fillColor(navy)
                    .text(`GSTIN: ${shopSettings.gstNumber}`, logoRight, sy); sy += 9;
                doc.font("Helvetica").fillColor(gray);
            }
            if (shopSettings.dlNumber) { doc.text(`DL: ${shopSettings.dlNumber}`, logoRight, sy); sy += 9; }
            if (shopSettings.website) { doc.text(shopSettings.website, logoRight, sy); sy += 9; }
            if (shopSettings.contactPerson) { doc.text(`Contact: ${shopSettings.contactPerson}`, logoRight, sy); sy += 9; }

            // ── INVOICE TITLE BLOCK (RIGHT) ──
            const titleX = rm - 190;
            doc.fontSize(22).font("Helvetica-Bold").fillColor(navy)
                .text("TAX INVOICE", titleX, y, { width: 190, align: "right" });

            doc.fontSize(7).font("Helvetica").fillColor(midGray)
                .text("Original for Recipient", titleX, y + 26, { width: 190, align: "right" });

            // Invoice number badge
            const invBadgeY = y + 40;
            doc.roundedRect(rm - 155, invBadgeY, 155, 18, 4).fill(navy);
            doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#ffffff")
                .text(bill.invoiceNumber, rm - 150, invBadgeY + 4, { width: 145, align: "center" });

            // Dates block
            let dy = invBadgeY + 26;
            doc.fontSize(7.5).font("Helvetica").fillColor(gray);
            const dateStr = new Date(bill.date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
            doc.text(`Issue Date:  ${dateStr}`, titleX, dy, { width: 190, align: "right" }); dy += 11;
            if (bill.dueDate) {
                const dueStr = new Date(bill.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
                doc.text(`Due Date:    ${dueStr}`, titleX, dy, { width: 190, align: "right" }); dy += 11;
            }
            if (bill.placeOfSupply) {
                doc.text(`Place of Supply:  ${bill.placeOfSupply}`, titleX, dy, { width: 190, align: "right" }); dy += 11;
            }

            // ── AMOUNT DUE BOX ──
            const adY = dy + 4;
            doc.roundedRect(rm - 170, adY, 170, 32, 5).fillAndStroke("#e8f6f3", teal);
            doc.fontSize(7).font("Helvetica").fillColor(slate)
                .text("Amount Due", rm - 165, adY + 5, { width: 60 });
            doc.fontSize(15).font("Helvetica-Bold").fillColor(navy)
                .text(`Rs. ${bill.grandTotal.toFixed(2)}`, rm - 100, adY + 5, { width: 95, align: "right" });

            y = Math.max(sy, adY + 40) + 8;

            // ── DIVIDER ──
            doc.moveTo(lm, y).lineTo(rm, y).strokeColor(teal).lineWidth(1.5).stroke();
            y += 12;

            // ── BILL TO / SHIP TO ──
            const billTo = bill.billTo || {};
            const shipTo = bill.shipTo || {};
            const halfW = (pw - 16) / 2;

            // Bill To box
            doc.roundedRect(lm, y, halfW, 70, 5).strokeColor(light).lineWidth(0.8).stroke();
            doc.fontSize(7).font("Helvetica-Bold").fillColor(teal)
                .text("BILL TO", lm + 10, y + 6, { width: halfW - 20 });
            doc.fontSize(9).font("Helvetica-Bold").fillColor(dark)
                .text(billTo.name || bill.customerName, lm + 10, y + 18, { width: halfW - 20 });
            let by = y + 30;
            doc.fontSize(7.5).font("Helvetica").fillColor(gray);
            if (billTo.address) { doc.text(billTo.address, lm + 10, by, { width: halfW - 20 }); by += 10; }
            if (billTo.phone || bill.customerPhone) { doc.text(billTo.phone || bill.customerPhone, lm + 10, by); by += 9; }
            if (billTo.email) { doc.text(billTo.email, lm + 10, by); by += 9; }
            if (billTo.gstin) { doc.font("Helvetica-Bold").fillColor(navy).text(`GSTIN: ${billTo.gstin}`, lm + 10, by); }

            // Ship To box
            if (shipTo.name || shipTo.address) {
                const sx = lm + halfW + 16;
                doc.roundedRect(sx, y, halfW, 70, 5).strokeColor(light).lineWidth(0.8).stroke();
                doc.fontSize(7).font("Helvetica-Bold").fillColor(teal)
                    .text("SHIP TO", sx + 10, y + 6, { width: halfW - 20 });
                doc.fontSize(9).font("Helvetica-Bold").fillColor(dark)
                    .text(shipTo.name || "", sx + 10, y + 18, { width: halfW - 20 });
                let shy = y + 30;
                doc.fontSize(7.5).font("Helvetica").fillColor(gray);
                if (shipTo.address) { doc.text(shipTo.address, sx + 10, shy, { width: halfW - 20 }); }
            }

            y += 80;

            // ── ITEMS TABLE ──
            // Simplified column widths — no overlap
            const c = {
                sno: { x: lm, w: 24 },
                desc: { x: lm + 24, w: 130 },
                hsn: { x: lm + 154, w: 52 },
                qty: { x: lm + 206, w: 38 },
                rate: { x: lm + 244, w: 56 },
                tax: { x: lm + 300, w: 50 },
                cgst: { x: lm + 350, w: 52 },
                sgst: { x: lm + 402, w: 52 },
                total: { x: lm + 454, w: pw - 454 + lm }
            };

            // Header
            doc.rect(lm, y, pw, 20).fill(headerBg);
            doc.fontSize(7).font("Helvetica-Bold").fillColor("#ffffff");
            doc.text("#", c.sno.x + 3, y + 6, { width: c.sno.w });
            doc.text("DESCRIPTION", c.desc.x + 3, y + 6, { width: c.desc.w });
            doc.text("HSN/SAC", c.hsn.x, y + 6, { width: c.hsn.w, align: "center" });
            doc.text("QTY", c.qty.x, y + 6, { width: c.qty.w, align: "center" });
            doc.text("RATE", c.rate.x, y + 6, { width: c.rate.w, align: "right" });
            doc.text("TAXABLE", c.tax.x, y + 6, { width: c.tax.w, align: "right" });
            doc.text("CGST", c.cgst.x, y + 6, { width: c.cgst.w, align: "right" });
            doc.text("SGST", c.sgst.x, y + 6, { width: c.sgst.w, align: "right" });
            doc.text("TOTAL", c.total.x, y + 6, { width: c.total.w, align: "right" });
            y += 22;

            // Rows
            bill.items.forEach((item, i) => {
                // Zebra stripe
                if (i % 2 === 0) {
                    doc.rect(lm, y, pw, 20).fill(rowEven);
                }
                const ry = y + 5;
                const cgstP = (item.gstPercent || 0) / 2;

                doc.fontSize(7.5).font("Helvetica").fillColor(dark);
                doc.text(String(i + 1), c.sno.x + 3, ry, { width: c.sno.w });
                doc.text(item.name, c.desc.x + 3, ry, { width: c.desc.w - 6 });
                doc.text(item.hsnSac || "-", c.hsn.x, ry, { width: c.hsn.w, align: "center" });
                doc.text(`${item.qty} ${item.uom || ""}`, c.qty.x, ry, { width: c.qty.w, align: "center" });
                doc.text(`Rs.${item.price.toFixed(2)}`, c.rate.x, ry, { width: c.rate.w, align: "right" });
                doc.text(`Rs.${(item.taxableValue || item.qty * item.price).toFixed(2)}`, c.tax.x, ry, { width: c.tax.w, align: "right" });

                doc.fontSize(6.8).fillColor(slate);
                doc.text(`${cgstP}% / Rs.${(item.cgst || 0).toFixed(2)}`, c.cgst.x, ry, { width: c.cgst.w, align: "right" });
                doc.text(`${cgstP}% / Rs.${(item.sgst || 0).toFixed(2)}`, c.sgst.x, ry, { width: c.sgst.w, align: "right" });

                doc.fontSize(7.5).font("Helvetica-Bold").fillColor(dark);
                doc.text(`Rs.${item.total.toFixed(2)}`, c.total.x, ry, { width: c.total.w, align: "right" });
                y += 20;
            });

            // Table bottom line
            doc.moveTo(lm, y + 1).lineTo(rm, y + 1).strokeColor(navy).lineWidth(0.8).stroke();
            y += 10;

            // ── TAX SUMMARY (RIGHT) + BANK DETAILS (LEFT) ──
            const summaryX = rm - 210;
            const valX = rm - 80;
            const valW = 80;
            let ty = y;

            // Tax breakup
            const taxGroups = {};
            bill.items.forEach(item => {
                const rate = item.gstPercent || 0;
                if (!taxGroups[rate]) taxGroups[rate] = { taxable: 0, cgst: 0, sgst: 0, total: 0 };
                taxGroups[rate].taxable += (item.taxableValue || item.qty * item.price);
                taxGroups[rate].cgst += (item.cgst || 0);
                taxGroups[rate].sgst += (item.sgst || 0);
                taxGroups[rate].total += item.total;
            });

            doc.fontSize(7.5).font("Helvetica").fillColor(gray);
            Object.keys(taxGroups).sort((a, b) => a - b).forEach(rate => {
                const g = taxGroups[rate];
                if (parseFloat(rate) > 0) {
                    doc.text(`GST @${rate}%`, summaryX, ty, { width: 55 });
                    doc.text(`Rs.${g.taxable.toFixed(2)}`, summaryX + 55, ty, { width: 50, align: "right" });
                    doc.fontSize(6.5).fillColor(midGray);
                    doc.text(`C: Rs.${g.cgst.toFixed(2)}`, summaryX + 108, ty, { width: 45, align: "right" });
                    doc.text(`S: Rs.${g.sgst.toFixed(2)}`, summaryX + 155, ty, { width: 45, align: "right" });
                    doc.fontSize(7.5).fillColor(gray);
                    ty += 13;
                }
            });

            ty += 3;
            doc.moveTo(summaryX, ty).lineTo(rm, ty).strokeColor(light).lineWidth(0.5).stroke();
            ty += 6;

            // Subtotal, Tax, Grand Total
            doc.fontSize(8).font("Helvetica").fillColor(gray);
            doc.text("Total Taxable Value", summaryX, ty);
            doc.text(`Rs. ${(bill.subtotal || 0).toFixed(2)}`, valX, ty, { width: valW, align: "right" });
            ty += 14;

            doc.text("Total Tax Amount", summaryX, ty);
            doc.text(`Rs. ${(bill.totalGst || 0).toFixed(2)}`, valX, ty, { width: valW, align: "right" });
            ty += 14;

            // Grand Total bar
            doc.roundedRect(summaryX - 5, ty - 2, rm - summaryX + 5, 26, 4).fill(navy);
            doc.fontSize(10).font("Helvetica-Bold").fillColor("#ffffff");
            doc.text("Grand Total", summaryX, ty + 4);
            doc.text(`Rs. ${bill.grandTotal.toFixed(2)}`, valX - 10, ty + 4, { width: valW + 10, align: "right" });
            ty += 30;

            // Amount in words
            const amountWords = bill.amountInWords || numberToWords(bill.grandTotal);
            doc.fontSize(7.5).font("Helvetica-Bold").fillColor(slate)
                .text("Amount in Words:", summaryX, ty);
            ty += 10;
            doc.fontSize(7).font("Helvetica-Oblique").fillColor(gray)
                .text(amountWords, summaryX, ty, { width: rm - summaryX });
            ty += 14;

            // ── BANK DETAILS (LEFT, parallel with totals) ──
            const bd = shopSettings.bankDetails || {};
            const hasBankInfo = bd.accountHolder || bd.bankName || bd.accountNumber;

            if (hasBankInfo) {
                doc.fontSize(8).font("Helvetica-Bold").fillColor(navy).text("Bank Details", lm, y);
                let bdy = y + 13;
                doc.fontSize(7).font("Helvetica").fillColor(gray);
                if (bd.accountHolder) { doc.text(`A/C Holder: ${bd.accountHolder}`, lm, bdy, { width: pw * 0.4 }); bdy += 10; }
                if (bd.bankName) { doc.text(`Bank: ${bd.bankName}`, lm, bdy); bdy += 10; }
                if (bd.accountNumber) { doc.text(`A/C No: ${bd.accountNumber}`, lm, bdy); bdy += 10; }
                if (bd.branch) { doc.text(`Branch: ${bd.branch}`, lm, bdy); bdy += 10; }
                if (bd.ifscCode) { doc.text(`IFSC: ${bd.ifscCode}`, lm, bdy); bdy += 10; }
            }

            y = Math.max(y + 60, ty) + 8;

            // ── PAYMENT QR ──
            if (shopSettings.upiId) {
                const upiStr = `upi://pay?pa=${shopSettings.upiId}&pn=${encodeURIComponent(shopSettings.shopName || "")}&am=${bill.grandTotal.toFixed(2)}&cu=INR`;
                try {
                    const qrDataUrl = await qrcode.toDataURL(upiStr, { width: 100, margin: 1 });
                    const qrBuf = Buffer.from(qrDataUrl.split(",")[1], "base64");
                    doc.image(qrBuf, lm, y, { width: 65, height: 65 });
                    doc.fontSize(7).font("Helvetica-Bold").fillColor(navy).text("Scan to Pay", lm + 70, y + 8);
                    doc.fontSize(7).font("Helvetica").fillColor(gray)
                        .text(`UPI: ${shopSettings.upiId}`, lm + 70, y + 20);
                } catch (e) { console.log("QR gen failed:", e.message); }
            }

            // Payment mode
            if (bill.paymentMode) {
                doc.fontSize(8).font("Helvetica").fillColor(gray)
                    .text(`Payment Mode: ${bill.paymentMode}`, lm + 170, y + 8);
            }

            // ── FOOTER ──
            const footerY = Math.max(y + 80, pageH - 100);
            doc.moveTo(lm, footerY).lineTo(rm, footerY).strokeColor(light).lineWidth(0.5).stroke();

            // Terms (left)
            doc.fontSize(7.5).font("Helvetica-Bold").fillColor(navy).text("Terms & Conditions", lm, footerY + 8);
            doc.fontSize(6.5).font("Helvetica").fillColor(midGray);
            doc.text(bill.notes || "Thank you for your business!", lm, footerY + 20, { width: pw * 0.5 });
            doc.text("This is a computer-generated invoice.", lm, footerY + 40, { width: pw * 0.5 });

            // Authorized Signatory (right)
            doc.moveTo(rm - 130, footerY + 38).lineTo(rm, footerY + 38).strokeColor(light).lineWidth(0.5).stroke();
            doc.fontSize(7).font("Helvetica-Bold").fillColor(navy)
                .text(`For ${shopSettings.shopName || ""}`, rm - 140, footerY + 8, { width: 140, align: "right" });
            doc.fontSize(6.5).font("Helvetica").fillColor(midGray)
                .text("Authorized Signatory", rm - 140, footerY + 42, { width: 140, align: "right" });

            // Bottom accent bar
            doc.rect(0, pageH - 6, pageW, 6).fill(teal);

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// ========== A4 PDF — Simple Retail Invoice ==========

function generateSimpleRetailPDFBuffer(bill, shopSettings) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 50 });
            const chunks = [];
            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const pw = doc.page.width - 100;
            const lm = 50;
            const rm = lm + pw;
            let y = 50;

            // Colors
            const primary = "#6d4c41";
            const accent = "#8d6e63";
            const dark = "#333333";
            const gray = "#777777";

            // =================== HEADER BANNER ===================
            doc.rect(lm - 10, y - 10, pw + 20, 80).fill("#efebe9");

            // Logo
            const logoBuffer = await getLogoBuffer(shopSettings);
            if (logoBuffer) {
                try {
                    doc.image(logoBuffer, lm + 5, y, { width: 50, height: 50 });
                } catch (e) { }
            }

            const hx = logoBuffer ? lm + 65 : lm + 10;
            if (shopSettings.shopName) {
                doc.fontSize(20).font("Helvetica-Bold").fillColor(primary)
                    .text(shopSettings.shopName, hx, y + 5, { width: pw / 2 });
            }
            doc.fontSize(8).font("Helvetica").fillColor(accent);
            if (shopSettings.address) doc.text(shopSettings.address, hx, y + 28, { width: pw / 2 });
            if (shopSettings.phone) doc.text(`+91 ${shopSettings.phone}`, hx, y + 39, { width: pw / 2 });

            // Contact info top right
            doc.fontSize(7.5).font("Helvetica").fillColor(gray);
            if (shopSettings.phone) doc.text(`+91 ${shopSettings.phone}`, rm - 160, y + 5, { width: 160, align: "right" });
            if (shopSettings.website) doc.text(shopSettings.website, rm - 160, y + 15, { width: 160, align: "right" });
            if (shopSettings.email) doc.text(shopSettings.email, rm - 160, y + 25, { width: 160, align: "right" });

            y += 85;

            // =================== INVOICE TITLE ===================
            doc.fontSize(28).font("Helvetica-Bold").fillColor(primary)
                .text("INVOICE", lm, y, { width: pw / 2 });

            // Invoice # and Date (right)
            doc.fontSize(9).font("Helvetica").fillColor(gray);
            doc.text("Invoice No:", rm - 160, y + 5, { width: 80 });
            doc.font("Helvetica-Bold").fillColor(dark).text(`#${bill.invoiceNumber}`, rm - 80, y + 5, { width: 80, align: "right" });
            doc.font("Helvetica").fillColor(gray);
            doc.text("Invoice Date:", rm - 160, y + 20, { width: 80 });
            doc.font("Helvetica").fillColor(dark);
            doc.text(new Date(bill.date).toLocaleDateString("en-IN"), rm - 80, y + 20, { width: 80, align: "right" });

            y += 42;

            // =================== INVOICE TO ===================
            doc.fontSize(10).font("Helvetica-Bold").fillColor(primary).text("Invoice To:", lm, y);
            y += 14;
            doc.fontSize(12).font("Helvetica-Bold").fillColor(dark)
                .text(bill.billTo?.name || bill.customerName, lm, y);
            y += 16;

            doc.fontSize(8.5).font("Helvetica").fillColor(gray);
            if (bill.billTo?.address) { doc.text(bill.billTo.address, lm, y); y += 12; }
            doc.text(bill.billTo?.phone || bill.customerPhone || "", lm, y); y += 12;
            if (bill.billTo?.email) { doc.text(bill.billTo.email, lm, y); y += 12; }

            y += 8;

            // =================== ITEMS TABLE ===================
            // Header bar
            doc.rect(lm, y, pw, 24).fill(accent);
            doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
            doc.text("ITEMS TO PAY", lm + 10, y + 6, { width: pw * 0.45 });
            doc.text("QTY", lm + pw * 0.5, y + 6, { width: pw * 0.15, align: "center" });
            doc.text("PRICE", lm + pw * 0.65, y + 6, { width: pw * 0.15, align: "right" });
            doc.text("TOTAL", lm + pw * 0.82, y + 6, { width: pw * 0.15, align: "right" });

            y += 30;

            // Rows
            doc.font("Helvetica").fontSize(9).fillColor(dark);
            bill.items.forEach((item, i) => {
                doc.text(item.name, lm + 10, y, { width: pw * 0.45 });
                doc.text(String(item.qty), lm + pw * 0.5, y, { width: pw * 0.15, align: "center" });
                doc.text(`Rs.${item.price.toFixed(2)}`, lm + pw * 0.65, y, { width: pw * 0.15, align: "right" });
                doc.text(`Rs.${item.total.toFixed(2)}`, lm + pw * 0.82, y, { width: pw * 0.15, align: "right" });
                y += 20;
            });

            y += 5;
            doc.moveTo(lm, y).lineTo(rm, y).strokeColor("#d7ccc8").lineWidth(0.5).stroke();
            y += 12;

            // =================== TOTALS ===================
            const totX = lm + pw * 0.6;
            const totVX = lm + pw * 0.82;
            const totVW = pw * 0.15;

            doc.fontSize(9).font("Helvetica").fillColor(gray);
            doc.text("Subtotal", totX, y, { width: totVW }); doc.text(`Rs.${(bill.subtotal || 0).toFixed(2)}`, totVX, y, { width: totVW, align: "right" }); y += 16;
            doc.text("Tax", totX, y, { width: totVW }); doc.text(`Rs.${(bill.totalGst || 0).toFixed(2)}`, totVX, y, { width: totVW, align: "right" }); y += 16;

            // Total bar
            doc.rect(totX - 5, y - 2, rm - totX + 5, 24).fill(accent);
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#ffffff");
            doc.text("TOTAL", totX, y + 3, { width: pw * 0.15 });
            doc.text(`Rs.${bill.grandTotal.toFixed(2)}`, totVX, y + 3, { width: totVW, align: "right" });
            y += 35;

            // =================== NOTES + PAYMENT ===================
            if (bill.notes) {
                doc.fontSize(8).font("Helvetica-Bold").fillColor(primary).text("Notes:", lm, y); y += 12;
                doc.fontSize(7.5).font("Helvetica").fillColor(gray).text(bill.notes, lm, y, { width: pw / 2 }); y += 18;
            }

            // Payment Method
            doc.fontSize(8.5).font("Helvetica-Bold").fillColor(primary).text("Payment Method", lm, y); y += 13;
            doc.fontSize(8).font("Helvetica").fillColor(gray);
            doc.text(`${bill.paymentMode || "Cash"}`, lm, y); y += 12;

            const bd = shopSettings.bankDetails || {};
            if (bd.accountNumber) {
                doc.text(`A/C: ${bd.accountNumber}`, lm, y); y += 10;
                if (bd.bankName) { doc.text(`Bank: ${bd.bankName}`, lm, y); y += 10; }
                if (bd.ifscCode) { doc.text(`IFSC: ${bd.ifscCode}`, lm, y); y += 10; }
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// ========== Thermal (80mm) PDF Generation ==========

function generateThermalPDFBuffer(bill, shopSettings) {
    return new Promise(async (resolve, reject) => {
        try {
            // 80mm ≈ 226 points
            const doc = new PDFDocument({
                size: [226, 800],
                margin: 10,
                bufferPages: true
            });
            const chunks = [];
            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const w = 206; // usable width
            let y = 10;

            // --- Shop Name ---
            if (shopSettings.shopName) {
                doc.fontSize(12).font("Helvetica-Bold").fillColor("#000000")
                    .text(shopSettings.shopName, 10, y, { width: w, align: "center" });
                y += 16;
            }
            if (shopSettings.address) {
                doc.fontSize(7).font("Helvetica").fillColor("#333333")
                    .text(shopSettings.address, 10, y, { width: w, align: "center" });
                y += 12;
            }
            if (shopSettings.gstNumber) {
                doc.fontSize(7).font("Helvetica").fillColor("#333333")
                    .text(`GSTIN: ${shopSettings.gstNumber}`, 10, y, { width: w, align: "center" });
                y += 12;
            }
            if (shopSettings.phone) {
                doc.fontSize(7).font("Helvetica").fillColor("#333333")
                    .text(`Ph: ${shopSettings.phone}`, 10, y, { width: w, align: "center" });
                y += 12;
            }

            // Dashed line
            y += 2;
            doc.fontSize(7).font("Helvetica").fillColor("#000000")
                .text("- ".repeat(30), 10, y, { width: w, align: "center" });
            y += 10;

            // TAX INVOICE
            doc.fontSize(9).font("Helvetica-Bold").fillColor("#000000")
                .text("TAX INVOICE", 10, y, { width: w, align: "center" });
            y += 14;

            // Invoice meta
            doc.fontSize(7).font("Helvetica").fillColor("#000000");
            doc.text(`Invoice: ${bill.invoiceNumber}`, 10, y);
            y += 10;
            doc.text(`Date: ${new Date(bill.date).toLocaleDateString("en-IN")} ${new Date(bill.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`, 10, y);
            y += 10;
            doc.text(`Customer: ${bill.customerName}`, 10, y);
            y += 10;
            doc.text(`Phone: ${bill.customerPhone}`, 10, y);
            y += 12;

            // Dashed line
            doc.text("- ".repeat(30), 10, y, { width: w, align: "center" });
            y += 10;

            // Column headers
            doc.fontSize(7).font("Helvetica-Bold");
            doc.text("Item", 10, y, { width: 80 });
            doc.text("Qty", 95, y, { width: 25, align: "center" });
            doc.text("Rate", 120, y, { width: 40, align: "right" });
            doc.text("Amt", 165, y, { width: 45, align: "right" });
            y += 12;

            // Items
            doc.font("Helvetica").fontSize(7);
            bill.items.forEach((item) => {
                doc.text(item.name, 10, y, { width: 80 });
                doc.text(String(item.qty), 95, y, { width: 25, align: "center" });
                doc.text(`₹${item.price.toFixed(0)}`, 120, y, { width: 40, align: "right" });
                doc.text(`₹${item.total.toFixed(0)}`, 165, y, { width: 45, align: "right" });
                y += 12;
                if (item.gstPercent > 0) {
                    doc.fontSize(6).fillColor("#555555");
                    doc.text(`  GST ${item.gstPercent}%: ₹${(item.gstAmount || 0).toFixed(2)}`, 10, y);
                    y += 9;
                    doc.fontSize(7).fillColor("#000000");
                }
            });

            // Dashed line
            doc.text("- ".repeat(30), 10, y, { width: w, align: "center" });
            y += 10;

            // Totals
            doc.fontSize(7).font("Helvetica");
            doc.text("Subtotal:", 10, y, { width: 120 });
            doc.text(`₹${(bill.subtotal || 0).toFixed(2)}`, 130, y, { width: 80, align: "right" });
            y += 11;
            doc.text("CGST:", 10, y, { width: 120 });
            doc.text(`₹${(bill.totalCgst || 0).toFixed(2)}`, 130, y, { width: 80, align: "right" });
            y += 11;
            doc.text("SGST:", 10, y, { width: 120 });
            doc.text(`₹${(bill.totalSgst || 0).toFixed(2)}`, 130, y, { width: 80, align: "right" });
            y += 12;

            // Grand total
            doc.fontSize(9).font("Helvetica-Bold");
            doc.text("TOTAL:", 10, y, { width: 120 });
            doc.text(`₹${bill.grandTotal.toFixed(2)}`, 130, y, { width: 80, align: "right" });
            y += 14;

            // Payment mode
            if (bill.paymentMode) {
                doc.fontSize(7).font("Helvetica");
                doc.text(`Payment: ${bill.paymentMode}`, 10, y, { width: w, align: "center" });
                y += 12;
            }

            // Dashed line
            doc.text("- ".repeat(30), 10, y, { width: w, align: "center" });
            y += 10;

            // Footer
            doc.fontSize(7).font("Helvetica").fillColor("#555555");
            doc.text("Thank you! Visit again.", 10, y, { width: w, align: "center" });
            y += 15;

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// ========== Legacy PDF (for old bills without GST) ==========

function generateLegacyPDFBuffer(bill) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 50 });
            const chunks = [];
            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const pageWidth = doc.page.width - 100;
            doc.fontSize(24).font("Helvetica-Bold").fillColor("#1a237e")
                .text("INVOICE", 50, 50);
            doc.fontSize(10).font("Helvetica").fillColor("#666666")
                .text(`Invoice #: ${bill.invoiceNumber}`, 50, 80)
                .text(`Date: ${new Date(bill.date).toLocaleDateString("en-IN")}`, 50, 95);
            doc.moveTo(50, 120).lineTo(50 + pageWidth, 120).strokeColor("#e0e0e0").lineWidth(1).stroke();
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#333333").text("Bill To:", 50, 135);
            doc.fontSize(10).font("Helvetica").fillColor("#555555")
                .text(bill.customerName, 50, 152)
                .text(`Phone: ${bill.customerPhone}`, 50, 167);

            const tableTop = 200;
            doc.fillColor("#f5f5f5");
            doc.rect(50, tableTop - 5, pageWidth, 25).fill();
            doc.fontSize(9).font("Helvetica-Bold").fillColor("#333333");
            doc.text("ITEM", 55, tableTop + 2, { width: 200 });
            doc.text("QTY", 280, tableTop + 2, { width: 60, align: "center" });
            doc.text("PRICE", 350, tableTop + 2, { width: 80, align: "right" });
            doc.text("TOTAL", 440, tableTop + 2, { width: 100, align: "right" });

            let yPos = tableTop + 30;
            doc.font("Helvetica").fontSize(9).fillColor("#444444");
            bill.items.forEach((item, i) => {
                if (i % 2 === 0) {
                    doc.fillColor("#fafafa");
                    doc.rect(50, yPos - 5, pageWidth, 22).fill();
                }
                doc.fillColor("#444444");
                doc.text(item.name, 55, yPos, { width: 200 });
                doc.text(String(item.qty), 280, yPos, { width: 60, align: "center" });
                doc.text(`Rs.${item.price.toFixed(2)}`, 350, yPos, { width: 80, align: "right" });
                doc.text(`Rs.${item.total.toFixed(2)}`, 440, yPos, { width: 100, align: "right" });
                yPos += 22;
            });

            yPos += 10;
            doc.moveTo(350, yPos).lineTo(50 + pageWidth, yPos).strokeColor("#1a237e").lineWidth(1.5).stroke();
            yPos += 10;
            doc.fontSize(12).font("Helvetica-Bold").fillColor("#1a237e")
                .text("GRAND TOTAL:", 350, yPos, { width: 80 });
            doc.text(`Rs.${bill.grandTotal.toFixed(2)}`, 440, yPos, { width: 100, align: "right" });

            yPos += 50;
            doc.moveTo(50, yPos).lineTo(50 + pageWidth, yPos).strokeColor("#e0e0e0").lineWidth(0.5).stroke();
            yPos += 10;
            doc.fontSize(8).font("Helvetica").fillColor("#999999")
                .text("Thank you for your business!", 50, yPos, { align: "center", width: pageWidth });
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// ========== API Routes ==========

// QR + Status
app.get("/qr", (req, res) => {
    res.json({
        qr: qrCodeData,
        ready: isReady,
        status: connectionStatus,
        reconnectAttempts: reconnectAttempts
    });
});

// Send text message
app.post("/send", async (req, res) => {
    const { phone, message } = req.body;
    if (!isReady) {
        return res.status(400).json({ error: "WhatsApp not connected" });
    }
    try {
        let finalNumber = phone;
        if (!finalNumber.startsWith("91")) {
            finalNumber = "91" + finalNumber;
        }
        const number = finalNumber + "@c.us";
        const isRegistered = await client.isRegisteredUser(number);
        if (!isRegistered) {
            return res.status(400).json({ error: "Number not on WhatsApp" });
        }
        await client.sendMessage(number, message);
        res.json({ success: true });
    } catch (error) {
        console.error("SEND ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Manual Disconnect
app.post("/disconnect", async (req, res) => {
    try {
        manualDisconnect = true;
        isReady = false;
        qrCodeData = "";
        connectionStatus = "disconnecting";
        reconnectAttempts = 0;

        // Destroy the current client safely
        if (client) {
            try {
                await client.logout();
                console.log("WhatsApp logged out");
            } catch (e) {
                console.log("Logout skipped (may already be logged out):", e.message);
            }
            try {
                await client.destroy();
                console.log("WhatsApp client destroyed");
            } catch (e) {
                console.log("Destroy warning:", e.message);
            }
            client = null;
        }

        // Clear stored auth session
        clearAuthSession();
        connectionStatus = "disconnected";
        console.log("WhatsApp Session Destroyed (Manual)");

        // Send response immediately so UI updates
        res.json({ success: true, message: "Disconnected. Preparing new QR..." });

        // Wait before re-initializing — gives Chromium time to exit
        // and WhatsApp servers time to process the logout
        setTimeout(() => {
            manualDisconnect = false;
            console.log("Re-initializing WhatsApp client...");
            initializeWhatsApp();
        }, 3000);

    } catch (err) {
        console.error("DISCONNECT ERROR:", err);
        manualDisconnect = false;
        connectionStatus = "disconnected";
        // Still try to re-initialize even on error
        setTimeout(() => {
            manualDisconnect = false;
            clearAuthSession();
            initializeWhatsApp();
        }, 3000);
        res.status(500).json({ error: "Disconnect had issues, retrying..." });
    }
});

// ========== Shop Settings ==========

app.get("/shop-settings", (req, res) => {
    const settings = loadShopSettings();
    res.json({ settings });
});

app.post("/shop-settings", (req, res) => {
    try {
        const { shopName, address, gstNumber, phone, email, logoUrl, upiId,
            website, dlNumber, contactPerson, bankDetails } = req.body;

        // Preserve existing logoBase64 if not explicitly cleared
        const existing = loadShopSettings();
        const settings = {
            shopName: shopName || "",
            address: address || "",
            gstNumber: gstNumber || "",
            phone: phone || "",
            email: email || "",
            logoUrl: logoUrl || "",
            logoBase64: existing.logoBase64 || "",
            upiId: upiId || "",
            website: website || "",
            dlNumber: dlNumber || "",
            contactPerson: contactPerson || "",
            bankDetails: {
                accountHolder: bankDetails?.accountHolder || "",
                bankName: bankDetails?.bankName || "",
                accountNumber: bankDetails?.accountNumber || "",
                branch: bankDetails?.branch || "",
                ifscCode: bankDetails?.ifscCode || ""
            }
        };
        saveShopSettings(settings);
        console.log("\ud83c\udfea Shop settings saved:", settings.shopName);
        res.json({ success: true, settings });
    } catch (err) {
        console.error("SHOP SETTINGS ERROR:", err);
        res.status(500).json({ error: "Failed to save shop settings" });
    }
});

// Upload logo (Base64 storage)
app.post("/upload-logo", upload.single("logo"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file uploaded" });
        }
        const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
        const settings = loadShopSettings();
        settings.logoBase64 = base64;
        saveShopSettings(settings);
        console.log(`\ud83d\uddbc\ufe0f Logo uploaded (${(req.file.size / 1024).toFixed(1)}KB)`);
        res.json({ success: true, logoBase64: base64, size: req.file.size });
    } catch (err) {
        console.error("LOGO UPLOAD ERROR:", err);
        res.status(500).json({ error: "Failed to upload logo" });
    }
});

// ========== Bills ==========

// Get all bills
app.get("/bills", (req, res) => {
    const bills = loadBillsData();
    res.json({ bills });
});

// Create a new bill (legacy — no GST)
app.post("/bills", (req, res) => {
    try {
        const { customerName, customerPhone, items } = req.body;
        if (!customerName || !customerPhone || !items || items.length === 0) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const processedItems = items.map(item => ({
            name: item.name,
            qty: parseInt(item.qty),
            price: parseFloat(item.price),
            total: parseInt(item.qty) * parseFloat(item.price)
        }));

        const grandTotal = processedItems.reduce((sum, item) => sum + item.total, 0);

        const bill = {
            invoiceNumber: generateInvoiceNumber(),
            date: new Date().toISOString(),
            customerName,
            customerPhone,
            items: processedItems,
            grandTotal
        };

        const bills = loadBillsData();
        bills.push(bill);
        saveBillsData(bills);
        console.log(`📄 Bill Created: ${bill.invoiceNumber} for ${customerName}`);
        res.json({ success: true, bill });
    } catch (err) {
        console.error("BILL CREATE ERROR:", err);
        res.status(500).json({ error: "Failed to create bill" });
    }
});

// Create a new invoice (with GST)
app.post("/invoices", (req, res) => {
    try {
        const { customerName, customerPhone, items, paymentMode,
            billTo, shipTo, dueDate, placeOfSupply, notes, template } = req.body;
        if (!customerName || !customerPhone || !items || items.length === 0) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const gstResult = calculateGST(items);

        const bill = {
            invoiceNumber: generateInvoiceNumber(),
            date: new Date().toISOString(),
            dueDate: dueDate || "",
            placeOfSupply: placeOfSupply || "",
            customerName,
            customerPhone,
            billTo: billTo || { name: customerName, phone: customerPhone },
            shipTo: shipTo || {},
            items: gstResult.items,
            subtotal: gstResult.subtotal,
            totalCgst: gstResult.totalCgst,
            totalSgst: gstResult.totalSgst,
            totalGst: gstResult.totalGst,
            grandTotal: gstResult.grandTotal,
            amountInWords: numberToWords(gstResult.grandTotal),
            paymentMode: paymentMode || "Cash",
            notes: notes || "",
            template: template || "gst"
        };

        const bills = loadBillsData();
        bills.push(bill);
        saveBillsData(bills);
        console.log(`\ud83d\udcc4 Invoice Created: ${bill.invoiceNumber} for ${customerName} | Total: \u20b9${bill.grandTotal}`);
        res.json({ success: true, bill });
    } catch (err) {
        console.error("INVOICE CREATE ERROR:", err);
        res.status(500).json({ error: "Failed to create invoice" });
    }
});

// Download / Reprint PDF
app.get("/bills/:invoiceNumber/pdf", async (req, res) => {
    try {
        const bills = loadBillsData();
        const bill = bills.find(b => b.invoiceNumber === req.params.invoiceNumber);
        if (!bill) {
            return res.status(404).json({ error: "Bill not found" });
        }

        const format = req.query.format || "a4";
        const template = req.query.template || bill.template || "gst";
        const shopSettings = loadShopSettings();
        let pdfBuffer;

        if (format === "thermal") {
            pdfBuffer = await generateThermalPDFBuffer(bill, shopSettings);
        } else if (template === "simple") {
            pdfBuffer = await generateSimpleRetailPDFBuffer(bill, shopSettings);
        } else {
            // Use new A4 if bill has GST fields, else legacy
            if (bill.subtotal !== undefined) {
                pdfBuffer = await generateA4PDFBuffer(bill, shopSettings);
            } else {
                pdfBuffer = await generateLegacyPDFBuffer(bill);
            }
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${bill.invoiceNumber}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error("PDF GENERATE ERROR:", err);
        res.status(500).json({ error: "Failed to generate PDF" });
    }
});

// Send bill as PDF via WhatsApp
app.post("/send-bill", async (req, res) => {
    const { invoiceNumber } = req.body;
    if (!isReady) {
        return res.status(400).json({ error: "WhatsApp not connected" });
    }

    try {
        const bills = loadBillsData();
        const bill = bills.find(b => b.invoiceNumber === invoiceNumber);
        if (!bill) {
            return res.status(404).json({ error: "Bill not found" });
        }

        const shopSettings = loadShopSettings();
        let pdfBuffer;

        if (bill.subtotal !== undefined) {
            pdfBuffer = await generateA4PDFBuffer(bill, shopSettings);
        } else {
            pdfBuffer = await generateLegacyPDFBuffer(bill);
        }

        const pdfBase64 = pdfBuffer.toString("base64");
        const media = new MessageMedia("application/pdf", pdfBase64, `${bill.invoiceNumber}.pdf`);

        let phone = bill.customerPhone;
        if (!phone.startsWith("91")) {
            phone = "91" + phone;
        }
        const number = phone + "@c.us";
        const isRegistered = await client.isRegisteredUser(number);
        if (!isRegistered) {
            return res.status(400).json({ error: "Customer number not on WhatsApp" });
        }

        const shopName = shopSettings.shopName || "Our Shop";
        await client.sendMessage(number, media, {
            caption: `📄 *Invoice ${bill.invoiceNumber}*\n\nDear ${bill.customerName},\nPlease find your invoice attached.\n\n*Total: ₹${bill.grandTotal.toFixed(2)}*\n\nThank you for your business! 🙏\n— ${shopName}`
        });

        console.log(`📤 PDF sent to ${bill.customerPhone} for invoice ${bill.invoiceNumber}`);
        res.json({ success: true });
    } catch (error) {
        console.error("SEND BILL ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Validate image URL
app.get("/validate-image", async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ valid: false, error: "No URL provided" });
    }
    try {
        const buffer = await fetchImageBuffer(url, 5000);
        if (buffer.length > 0) {
            res.json({ valid: true, size: buffer.length });
        } else {
            res.json({ valid: false, error: "Empty response" });
        }
    } catch (err) {
        res.json({ valid: false, error: err.message });
    }
});

// ========== Image URL Generation ==========

// Ensure generated images directory exists
const GENERATED_DIR = path.join(__dirname, "public", "generated");
if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

// Generate UPI Payment QR Code image
app.get("/generate-qr", async (req, res) => {
    const { upiId, name, amount, invoiceNumber } = req.query;

    if (!upiId) {
        return res.status(400).json({ error: "UPI ID is required" });
    }

    try {
        // Build UPI deep link string
        let upiString = `upi://pay?pa=${encodeURIComponent(upiId)}`;
        if (name) upiString += `&pn=${encodeURIComponent(name)}`;
        if (amount) upiString += `&am=${encodeURIComponent(amount)}`;
        if (invoiceNumber) upiString += `&tn=${encodeURIComponent("Payment for " + invoiceNumber)}`;
        upiString += "&cu=INR";

        // Generate QR code as data URL
        const qrDataUrl = await qrcode.toDataURL(upiString, {
            width: 300,
            margin: 2,
            color: { dark: "#000000", light: "#ffffff" }
        });

        // Also save as file for URL reference
        const filename = `qr_${invoiceNumber || "payment"}_${Date.now()}.png`;
        const filepath = path.join(GENERATED_DIR, filename);
        const qrBuffer = Buffer.from(qrDataUrl.split(",")[1], "base64");
        fs.writeFileSync(filepath, qrBuffer);

        const imageUrl = `/generated/${filename}`;

        res.json({
            success: true,
            qrDataUrl,
            imageUrl,
            upiString
        });
    } catch (err) {
        console.error("QR GENERATE ERROR:", err);
        res.status(500).json({ error: "Failed to generate QR code" });
    }
});

// Generate invoice as PNG image (shareable)
app.get("/bills/:invoiceNumber/image", async (req, res) => {
    try {
        const bills = loadBillsData();
        const bill = bills.find(b => b.invoiceNumber === req.params.invoiceNumber);
        if (!bill) {
            return res.status(404).json({ error: "Bill not found" });
        }

        const shopSettings = loadShopSettings();

        // Generate a clean PDF and return it — for image preview we create a
        // structured HTML-based representation returned as JSON for client-side rendering
        // The client can use html2canvas or similar to create actual screenshot

        // Build invoice image data for client rendering
        const imageData = {
            shop: {
                name: shopSettings.shopName || "",
                address: shopSettings.address || "",
                gstNumber: shopSettings.gstNumber || "",
                phone: shopSettings.phone || "",
                email: shopSettings.email || "",
                logoUrl: shopSettings.logoUrl || ""
            },
            invoice: {
                number: bill.invoiceNumber,
                date: bill.date,
                customerName: bill.customerName,
                customerPhone: bill.customerPhone,
                items: bill.items,
                subtotal: bill.subtotal || bill.grandTotal,
                totalCgst: bill.totalCgst || 0,
                totalSgst: bill.totalSgst || 0,
                totalGst: bill.totalGst || 0,
                grandTotal: bill.grandTotal,
                paymentMode: bill.paymentMode || "Cash"
            }
        };

        res.json({ success: true, imageData });
    } catch (err) {
        console.error("IMAGE DATA ERROR:", err);
        res.status(500).json({ error: "Failed to generate image data" });
    }
});

// Dynamic Image URL Generator — generate URLs for logos, QR codes, etc.
app.post("/generate-image-url", async (req, res) => {
    const { type, data } = req.body;

    try {
        switch (type) {
            case "logo": {
                // Validate and cache the logo URL
                const { url } = data;
                if (!url) return res.status(400).json({ error: "URL is required" });

                const buffer = await fetchImageBuffer(url, 5000);
                if (buffer.length === 0) {
                    return res.json({ valid: false, error: "Empty image" });
                }

                // Save locally for reliable access
                const ext = url.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)?.[1] || "png";
                const filename = `logo_${Date.now()}.${ext}`;
                const filepath = path.join(GENERATED_DIR, filename);
                fs.writeFileSync(filepath, buffer);

                res.json({
                    success: true,
                    originalUrl: url,
                    localUrl: `/generated/${filename}`,
                    size: buffer.length
                });
                break;
            }
            case "upi-qr": {
                // Generate UPI QR code
                const { upiId, name, amount, note } = data;
                if (!upiId) return res.status(400).json({ error: "UPI ID required" });

                let upiString = `upi://pay?pa=${encodeURIComponent(upiId)}`;
                if (name) upiString += `&pn=${encodeURIComponent(name)}`;
                if (amount) upiString += `&am=${encodeURIComponent(amount)}`;
                if (note) upiString += `&tn=${encodeURIComponent(note)}`;
                upiString += "&cu=INR";

                const qrDataUrl = await qrcode.toDataURL(upiString, { width: 300, margin: 2 });
                const filename = `upi_qr_${Date.now()}.png`;
                const filepath = path.join(GENERATED_DIR, filename);
                fs.writeFileSync(filepath, Buffer.from(qrDataUrl.split(",")[1], "base64"));

                res.json({
                    success: true,
                    qrDataUrl,
                    imageUrl: `/generated/${filename}`,
                    upiString
                });
                break;
            }
            case "invoice-qr": {
                // Generate a QR code containing invoice details URL
                const { invoiceNumber, baseUrl } = data;
                if (!invoiceNumber) return res.status(400).json({ error: "Invoice number required" });

                const invoiceUrl = `${baseUrl || "http://localhost:5000"}/bills/${invoiceNumber}/pdf?format=a4`;
                const qrDataUrl = await qrcode.toDataURL(invoiceUrl, { width: 250, margin: 2 });
                const filename = `inv_qr_${invoiceNumber}_${Date.now()}.png`;
                const filepath = path.join(GENERATED_DIR, filename);
                fs.writeFileSync(filepath, Buffer.from(qrDataUrl.split(",")[1], "base64"));

                res.json({
                    success: true,
                    qrDataUrl,
                    imageUrl: `/generated/${filename}`,
                    invoiceUrl
                });
                break;
            }
            default:
                res.status(400).json({ error: `Unknown type: ${type}. Supported: logo, upi-qr, invoice-qr` });
        }
    } catch (err) {
        console.error("IMAGE URL GENERATE ERROR:", err);
        res.status(500).json({ error: err.message });
    }
});

// Image proxy — fetch external image through server (avoids CORS issues)
app.get("/image-proxy", async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: "No URL provided" });
    }
    try {
        const buffer = await fetchImageBuffer(url, 8000);
        // Detect content type from URL
        const ext = url.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)?.[1] || "png";
        const mimeTypes = {
            png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
            gif: "image/gif", webp: "image/webp", svg: "image/svg+xml"
        };
        res.setHeader("Content-Type", mimeTypes[ext] || "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Health check
app.get("/health", (req, res) => {
    res.json({
        server: "running",
        whatsapp: connectionStatus,
        ready: isReady,
        reconnectAttempts: reconnectAttempts
    });
});

// ========== PUBLIC API v1 (Authenticated) ==========

const apiRouter = express.Router();
apiRouter.use(apiAuth);
apiRouter.use(apiRateLimit);

// API v1: Health / Ping
apiRouter.get("/health", (req, res) => {
    res.json({
        status: "ok",
        server: "running",
        whatsapp: connectionStatus,
        ready: isReady,
        apiKey: req.apiKeyEntry.name,
        rateLimit: {
            limit: req.apiKeyEntry.rateLimit,
            remaining: parseInt(res.getHeader("X-RateLimit-Remaining")),
            reset: res.getHeader("X-RateLimit-Reset")
        }
    });
});

// API v1: WhatsApp Status
apiRouter.get("/status", (req, res) => {
    res.json({
        whatsapp: {
            connected: isReady,
            status: connectionStatus,
            qrAvailable: !!qrCodeData
        }
    });
});

// API v1: Create Invoice (GST)
apiRouter.post("/invoices", (req, res) => {
    try {
        const { customerName, customerPhone, items, paymentMode,
            billTo, shipTo, dueDate, placeOfSupply, notes, template } = req.body;

        if (!customerName || !customerPhone || !items || items.length === 0) {
            return res.status(400).json({
                error: "Missing required fields",
                required: ["customerName", "customerPhone", "items[]"],
                example: {
                    customerName: "John Doe",
                    customerPhone: "9876543210",
                    items: [{ name: "Item 1", qty: 1, price: 100, gstPercent: 18, hsnSac: "1234", uom: "NOS" }]
                }
            });
        }

        const gstResult = calculateGST(items);
        const bill = {
            invoiceNumber: generateInvoiceNumber(),
            date: new Date().toISOString(),
            dueDate: dueDate || "",
            placeOfSupply: placeOfSupply || "",
            customerName,
            customerPhone,
            billTo: billTo || { name: customerName, phone: customerPhone },
            shipTo: shipTo || {},
            items: gstResult.items,
            subtotal: gstResult.subtotal,
            totalCgst: gstResult.totalCgst,
            totalSgst: gstResult.totalSgst,
            totalGst: gstResult.totalGst,
            grandTotal: gstResult.grandTotal,
            amountInWords: numberToWords(gstResult.grandTotal),
            paymentMode: paymentMode || "Cash",
            notes: notes || "",
            template: template || "gst",
            apiGenerated: true,
            apiKeyName: req.apiKeyEntry.name
        };

        const bills = loadBillsData();
        bills.push(bill);
        saveBillsData(bills);
        console.log(`[API] Invoice Created: ${bill.invoiceNumber} by ${req.apiKeyEntry.name}`);
        res.json({ success: true, invoice: bill });
    } catch (err) {
        console.error("[API] INVOICE CREATE ERROR:", err);
        res.status(500).json({ error: "Failed to create invoice" });
    }
});

// API v1: List Invoices
apiRouter.get("/invoices", (req, res) => {
    const bills = loadBillsData();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const start = (page - 1) * limit;
    const paged = bills.slice().reverse().slice(start, start + limit);

    res.json({
        invoices: paged,
        pagination: {
            page,
            limit,
            total: bills.length,
            totalPages: Math.ceil(bills.length / limit)
        }
    });
});

// API v1: Get Single Invoice
apiRouter.get("/invoices/:id", (req, res) => {
    const bills = loadBillsData();
    const bill = bills.find(b => b.invoiceNumber === req.params.id);
    if (!bill) {
        return res.status(404).json({ error: "Invoice not found" });
    }
    res.json({ invoice: bill });
});

// API v1: Download Invoice PDF
apiRouter.get("/invoices/:id/pdf", async (req, res) => {
    try {
        const bills = loadBillsData();
        const bill = bills.find(b => b.invoiceNumber === req.params.id);
        if (!bill) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        const format = req.query.format || "a4";
        const template = req.query.template || bill.template || "gst";
        const shopSettings = loadShopSettings();
        let pdfBuffer;

        if (format === "thermal") {
            pdfBuffer = await generateThermalPDFBuffer(bill, shopSettings);
        } else if (template === "simple") {
            pdfBuffer = await generateSimpleRetailPDFBuffer(bill, shopSettings);
        } else {
            if (bill.subtotal !== undefined) {
                pdfBuffer = await generateA4PDFBuffer(bill, shopSettings);
            } else {
                pdfBuffer = await generateLegacyPDFBuffer(bill);
            }
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${bill.invoiceNumber}.pdf"`);
        res.send(pdfBuffer);
    } catch (err) {
        console.error("[API] PDF ERROR:", err);
        res.status(500).json({ error: "Failed to generate PDF" });
    }
});

// API v1: Send Text Message via WhatsApp
apiRouter.post("/send-message", async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ error: "Missing required fields: phone, message" });
    }
    if (!isReady) {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }

    try {
        let finalNumber = phone;
        if (!finalNumber.startsWith("91")) finalNumber = "91" + finalNumber;
        const number = finalNumber + "@c.us";
        const isRegistered = await client.isRegisteredUser(number);
        if (!isRegistered) {
            return res.status(400).json({ error: "Number not registered on WhatsApp" });
        }
        await client.sendMessage(number, message);
        console.log(`[API] Message sent to ${phone} by ${req.apiKeyEntry.name}`);
        res.json({ success: true, phone, messageSent: true });
    } catch (error) {
        console.error("[API] SEND MESSAGE ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// API v1: Send Invoice PDF via WhatsApp
apiRouter.post("/send-invoice", async (req, res) => {
    const { invoiceNumber } = req.body;

    if (!invoiceNumber) {
        return res.status(400).json({ error: "Missing required field: invoiceNumber" });
    }
    if (!isReady) {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }

    try {
        const bills = loadBillsData();
        const bill = bills.find(b => b.invoiceNumber === invoiceNumber);
        if (!bill) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        const shopSettings = loadShopSettings();
        let pdfBuffer;
        if (bill.subtotal !== undefined) {
            pdfBuffer = await generateA4PDFBuffer(bill, shopSettings);
        } else {
            pdfBuffer = await generateLegacyPDFBuffer(bill);
        }

        const pdfBase64 = pdfBuffer.toString("base64");
        const media = new MessageMedia("application/pdf", pdfBase64, `${bill.invoiceNumber}.pdf`);

        let phone = bill.customerPhone;
        if (!phone.startsWith("91")) phone = "91" + phone;
        const number = phone + "@c.us";
        const isRegistered = await client.isRegisteredUser(number);
        if (!isRegistered) {
            return res.status(400).json({ error: "Customer number not registered on WhatsApp" });
        }

        const shopName = shopSettings.shopName || "Our Shop";
        await client.sendMessage(number, media, {
            caption: `Invoice ${bill.invoiceNumber}\n\nDear ${bill.customerName},\nPlease find your invoice attached.\n\nTotal: Rs.${bill.grandTotal.toFixed(2)}\n\nThank you!\n- ${shopName}`
        });

        console.log(`[API] Invoice PDF sent to ${bill.customerPhone} by ${req.apiKeyEntry.name}`);
        res.json({ success: true, invoiceNumber, sentTo: bill.customerPhone });
    } catch (error) {
        console.error("[API] SEND INVOICE ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// API v1: Get Shop Settings
apiRouter.get("/shop-settings", (req, res) => {
    const settings = loadShopSettings();
    // Don't expose base64 logo in API response (can be large)
    const { logoBase64, ...safeSettings } = settings;
    res.json({ settings: safeSettings, hasLogo: !!logoBase64 });
});

// API v1: Update Shop Settings
apiRouter.post("/shop-settings", (req, res) => {
    try {
        const { shopName, address, gstNumber, phone, email, logoUrl, upiId,
            website, dlNumber, contactPerson, bankDetails } = req.body;

        const existing = loadShopSettings();
        const settings = {
            shopName: shopName || existing.shopName || "",
            address: address || existing.address || "",
            gstNumber: gstNumber || existing.gstNumber || "",
            phone: phone || existing.phone || "",
            email: email || existing.email || "",
            logoUrl: logoUrl || existing.logoUrl || "",
            logoBase64: existing.logoBase64 || "",
            upiId: upiId || existing.upiId || "",
            website: website || existing.website || "",
            dlNumber: dlNumber || existing.dlNumber || "",
            contactPerson: contactPerson || existing.contactPerson || "",
            bankDetails: {
                accountHolder: bankDetails?.accountHolder || existing.bankDetails?.accountHolder || "",
                bankName: bankDetails?.bankName || existing.bankDetails?.bankName || "",
                accountNumber: bankDetails?.accountNumber || existing.bankDetails?.accountNumber || "",
                branch: bankDetails?.branch || existing.bankDetails?.branch || "",
                ifscCode: bankDetails?.ifscCode || existing.bankDetails?.ifscCode || ""
            }
        };
        saveShopSettings(settings);
        console.log(`[API] Shop settings updated by ${req.apiKeyEntry.name}`);
        const { logoBase64: _logo, ...safeSettings } = settings;
        res.json({ success: true, settings: safeSettings });
    } catch (err) {
        console.error("[API] SHOP SETTINGS ERROR:", err);
        res.status(500).json({ error: "Failed to save shop settings" });
    }
});

// API v1: Generate UPI QR Code
apiRouter.post("/generate-qr", async (req, res) => {
    const { upiId, name, amount, note } = req.body;

    if (!upiId) {
        return res.status(400).json({ error: "UPI ID is required" });
    }

    try {
        let upiString = `upi://pay?pa=${encodeURIComponent(upiId)}`;
        if (name) upiString += `&pn=${encodeURIComponent(name)}`;
        if (amount) upiString += `&am=${encodeURIComponent(amount)}`;
        if (note) upiString += `&tn=${encodeURIComponent(note)}`;
        upiString += "&cu=INR";

        const qrDataUrl = await qrcode.toDataURL(upiString, { width: 300, margin: 2 });
        res.json({ success: true, qrDataUrl, upiString });
    } catch (err) {
        console.error("[API] QR ERROR:", err);
        res.status(500).json({ error: "Failed to generate QR code" });
    }
});

// ========== WhatsApp Connection Routes ==========

app.get("/qr", (req, res) => {
    res.json({
        qr: qrCodeData,
        status: connectionStatus,
        ready: isReady,
        reconnectAttempts
    });
});

app.post("/disconnect", async (req, res) => {
    manualDisconnect = true;
    try {
        if (client) {
            await client.logout();
            // wait a bit
            await new Promise(r => setTimeout(r, 1000));
            await client.destroy();
        }
    } catch (e) {
        console.error("Logout error:", e.message);
    }

    // Clear session data
    isReady = false;
    qrCodeData = "";
    connectionStatus = "disconnected";
    clearAuthSession();

    // Re-init after a delay to show QR again
    setTimeout(() => {
        manualDisconnect = false;
        initializeWhatsApp();
    }, 2000);

    res.json({ success: true, message: "Disconnected" });
});

app.post("/send", async (req, res) => {
    const { phone, message } = req.body;
    if (!isReady) return res.status(503).json({ error: "WhatsApp not connected" });

    try {
        let finalNumber = phone;
        if (!finalNumber.startsWith("91")) finalNumber = "91" + finalNumber;
        const number = finalNumber + "@c.us";

        await client.sendMessage(number, message);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Mount API v1 router
app.use("/api/v1", apiRouter);

// ========== API Admin Routes (localhost only) ==========

// Admin: Generate new API key
app.post("/api/admin/keys", (req, res) => {
    const { name, rateLimit } = req.body;
    const entry = generateApiKey(name);
    if (rateLimit && typeof rateLimit === "number") {
        const keys = loadApiKeys();
        const k = keys.find(k => k.key === entry.key);
        if (k) { k.rateLimit = rateLimit; saveApiKeys(keys); entry.rateLimit = rateLimit; }
    }
    console.log(`[Admin] API key generated: "${entry.name}" (${entry.key.slice(0, 16)}...)`);
    res.json({ success: true, apiKey: entry });
});

// Admin: List all API keys
app.get("/api/admin/keys", (req, res) => {
    const keys = loadApiKeys();
    // Mask the full key for security
    const masked = keys.map(k => ({
        ...k,
        key: k.key.slice(0, 16) + "..." + k.key.slice(-6),
        fullKey: k.key // included for admin use
    }));
    res.json({ keys: masked, total: keys.length });
});

// Admin: Revoke an API key
app.delete("/api/admin/keys/:key", (req, res) => {
    const keys = loadApiKeys();
    const key = keys.find(k => k.key === req.params.key);
    if (!key) {
        return res.status(404).json({ error: "API key not found" });
    }
    key.active = false;
    saveApiKeys(keys);
    console.log(`[Admin] API key revoked: "${key.name}"`);
    res.json({ success: true, message: `Key "${key.name}" has been revoked` });
});

// API Docs redirect
app.get("/api/docs", (req, res) => {
    res.redirect("/api-docs.html");
});

app.listen(5000, () => {
    console.log("Server running on http://localhost:5000");
    console.log("API Docs: http://localhost:5000/api/docs");
});
