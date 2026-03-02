# Multi-Session WhatsApp API Microservice 🚀

A highly concurrent, headless WhatsApp API microservice powered by `whatsapp-web.js` and Express.js. Designed to manage multiple completely isolated WhatsApp sessions from a single central codebase.

## 🌟 Multi-Session Architecture

By abstracting sessions into unique IDs mappings (e.g. `clientA`, `clientB`, `marketingTeam`, `supportTeam`), this microservice can run multiple WhatsApp accounts on a single container!
Instead of globally hitting `/api/v2/whatsapp/send`, you now map requests to specific dynamic variables:

**Format:** `/api/v2/whatsapp/:sessionId/...`

### 🔑 User Workflow (4+ Persons Concurrency)

If 4 people need to use this without stepping on each other's toes, simply assign each person a `sessionId`:
1. Use `POST /api/v2/whatsapp/personA/start`
2. Wait 10 seconds, and get the QR via `GET /api/v2/whatsapp/personA/qr`
3. Now the person is globally linked to the string "personA", completely isolated from "personB"!

---

## 🌎 Vercel Deployment Instructions

You can deploy this API to Vercel instantly using the attached `vercel.json`!

1. Install the Vercel CLI: `npm i -g vercel`
2. Run `vercel login` and follow the prompts.
3. Open your terminal inside this project's directory.
4. Run: `vercel` (and hit Enter to accept defaults)
5. Run: `vercel --prod` to push your build to production!

---

### ⚠️ IMPORTANT VERCEL DISCLAIMER (Serverless vs Puppeteer)

**While you CAN deploy this on Vercel seamlessly using the `vercel.json` provided, you need to understand Vercel's Serverless architecture limitations!**

Vercel freezes functions the millisecond your request returns a response (or drops it after a 10s-60s timeout limit). WhatsApp bots require a persistent, 24/7 background long-polling socket connection.
**If deployed directly to Vercel Serverless:**
1. Background incoming messages will NOT be retrieved reliably as the Lambda container goes to sleep.
2. Initializing `puppeteer` (Headless browser) takes exactly 10-15s, which exceeds Vercel Hobby tier timeout limits (meaning `/start` might hang depending on your plan tier!).

### ✅ Better Deployment Options (For 24/7 Online Bots)

For the absolute best production-grade reliability (keeping the underlying Chrome browser awake permanently), it is strictly recommended you deploy this application to environments running Docker or Standard Node VPS environments like:

- **Railway.app** (No-Config required, just specify this GitHub repository, and Railway will run it on an isolated container forever).
- **Render.com** (Highly scalable, similar execution node styles to Railway, supports websockets perfectly).
- **Digital Ocean / AWS EC2** (Standard Linux VPS).

Simply upload the codebase, run `npm install`, and `npm start` (`node server.js`), and your 4 developers can reliably utilize the endpoints concurrently without any sleep-wake cycle lags!

---

## ⚡ API Endpoints Quick Reference

Every single endpoint must include a `:sessionId` variable mapping in the URL path. 

- **Start Client:** `POST /api/v2/whatsapp/:sessionId/start`
- **Session Status:** `GET /api/v2/whatsapp/:sessionId/status`
- **Get QR Code:** `GET /api/v2/whatsapp/:sessionId/qr`
- **Request Pair Code:** `POST /api/v2/whatsapp/:sessionId/pair { "phone": "98765..." }`
- **Send Msg:** `POST /api/v2/whatsapp/:sessionId/send { "phone": "...", "message": "Hi" }`
- **Send Receipt (Base64 file):** `POST /api/v2/whatsapp/:sessionId/send-receipt`
- **Fetch Chat History:** `GET /api/v2/whatsapp/:sessionId/messages?phone=919876543210&limit=50`
- **Logout Client:** `POST /api/v2/whatsapp/:sessionId/logout`
