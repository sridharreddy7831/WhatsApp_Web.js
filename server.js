const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const apiRoutes = require("./src/routes");

const path = require("path");

const app = express();

// Increase JSON limit depending on base64 payloads size
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));

// Root health check
app.get("/", (req, res) => {
    res.json({ status: "Microservice running", info: "Use /api/whatsapp/start to begin, or /api/whatsapp/:sessionId/start for multi-user." });
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// API Docs redirect
app.get("/api/docs", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "api-docs.html"));
});

// Setup Mount point
app.use("/api", apiRoutes);

// Export the Express App for serverless (Vercel) configurations
module.exports = app;

// Listen if run directly via Node / nodemon
if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`\ud83d\ude80 Multi-Session WhatsApp API Microservice running on port ${PORT}`);
        console.log(`🚀 Docs Available at: http://localhost:${PORT}/api/docs`);
        console.log(`-----------------------------------------------------`);
        console.log(`For Single User:   GET /api/whatsapp/start`);
        console.log(`For Multi-User:    GET /api/whatsapp/your-name/start`);
        console.log(`-----------------------------------------------------\n`);
    });
}
