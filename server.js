const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

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

// ========== Bills Data ==========

const BILLS_FILE = path.join(__dirname, "bills.json");

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

function generateInvoiceNumber() {
    const now = new Date();
    const y = now.getFullYear().toString().slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
    return `INV-${y}${m}${d}-${rand}`;
}

// ========== PDF Generation (in-memory, no file saved) ==========

function generatePDFBuffer(bill) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: "A4", margin: 50 });
            const chunks = [];

            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const pageWidth = doc.page.width - 100; // margins

            // Header
            doc.fontSize(24).font("Helvetica-Bold").fillColor("#1a237e")
                .text("INVOICE", 50, 50);

            doc.fontSize(10).font("Helvetica").fillColor("#666666")
                .text(`Invoice #: ${bill.invoiceNumber}`, 50, 80)
                .text(`Date: ${new Date(bill.date).toLocaleDateString("en-IN")}`, 50, 95);

            // Horizontal line
            doc.moveTo(50, 120).lineTo(50 + pageWidth, 120).strokeColor("#e0e0e0").lineWidth(1).stroke();

            // Customer details
            doc.fontSize(11).font("Helvetica-Bold").fillColor("#333333")
                .text("Bill To:", 50, 135);
            doc.fontSize(10).font("Helvetica").fillColor("#555555")
                .text(bill.customerName, 50, 152)
                .text(`Phone: ${bill.customerPhone}`, 50, 167);

            // Table header
            const tableTop = 200;
            doc.fillColor("#f5f5f5");
            doc.rect(50, tableTop - 5, pageWidth, 25).fill();

            doc.fontSize(9).font("Helvetica-Bold").fillColor("#333333");
            doc.text("ITEM", 55, tableTop + 2, { width: 200 });
            doc.text("QTY", 280, tableTop + 2, { width: 60, align: "center" });
            doc.text("PRICE", 350, tableTop + 2, { width: 80, align: "right" });
            doc.text("TOTAL", 440, tableTop + 2, { width: 100, align: "right" });

            // Table rows
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

            // Total line
            yPos += 10;
            doc.moveTo(350, yPos).lineTo(50 + pageWidth, yPos).strokeColor("#1a237e").lineWidth(1.5).stroke();
            yPos += 10;

            doc.fontSize(12).font("Helvetica-Bold").fillColor("#1a237e")
                .text("GRAND TOTAL:", 350, yPos, { width: 80 });
            doc.text(`Rs.${bill.grandTotal.toFixed(2)}`, 440, yPos, { width: 100, align: "right" });

            // Footer
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
        await client.destroy();
        isReady = false;
        qrCodeData = "";
        connectionStatus = "disconnected";
        reconnectAttempts = 0;
        console.log("WhatsApp Session Destroyed (Manual)");

        clearAuthSession();

        manualDisconnect = false;
        initializeWhatsApp();

        res.json({ success: true });
    } catch (err) {
        console.error("DISCONNECT ERROR:", err);
        manualDisconnect = false;
        res.status(500).json({ error: "Failed to disconnect" });
    }
});

// Get all bills
app.get("/bills", (req, res) => {
    const bills = loadBillsData();
    res.json({ bills });
});

// Create a new bill
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

// Send bill as PDF via WhatsApp (no file saved to disk)
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

        // Generate PDF in memory
        const pdfBuffer = await generatePDFBuffer(bill);
        const pdfBase64 = pdfBuffer.toString("base64");

        // Create MessageMedia from base64 (no file saved)
        const media = new MessageMedia(
            "application/pdf",
            pdfBase64,
            `${bill.invoiceNumber}.pdf`
        );

        // Format phone number
        let phone = bill.customerPhone;
        if (!phone.startsWith("91")) {
            phone = "91" + phone;
        }
        const number = phone + "@c.us";

        const isRegistered = await client.isRegisteredUser(number);
        if (!isRegistered) {
            return res.status(400).json({ error: "Customer number not on WhatsApp" });
        }

        // Send PDF
        await client.sendMessage(number, media, {
            caption: `📄 *Invoice ${bill.invoiceNumber}*\n\nDear ${bill.customerName},\nPlease find your invoice attached.\n\n*Total: ₹${bill.grandTotal.toFixed(2)}*\n\nThank you for your business! 🙏`
        });

        console.log(`📤 PDF sent to ${bill.customerPhone} for invoice ${bill.invoiceNumber}`);

        res.json({ success: true });
    } catch (error) {
        console.error("SEND BILL ERROR:", error);
        res.status(500).json({ error: error.message });
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

app.listen(5000, () => {
    console.log("Server running on http://localhost:5000");
});