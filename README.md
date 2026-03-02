# Multi-Session WhatsApp API Microservice 🚀

A highly concurrent, headless WhatsApp API microservice powered by `whatsapp-web.js` and Express.js. Designed to manage multiple completely isolated WhatsApp sessions from a single central codebase.

## 🌟 Multi-Session Architecture

By abstracting sessions into unique IDs mappings (e.g. `clientA`, `clientB`, `marketingTeam`, `supportTeam`), this microservice can run multiple WhatsApp accounts on a single container! 
But it also fully supports operating as a **simple, default single-user instance** without needing to supply an ID!

### 👤 Option A: Single-User Workflow (No Session ID)

If you just need a standard WhatsApp bot for yourself, skip the `sessionId` param! The API automatically routes you to a background session called `default`.

1. **Start Server:** `GET /api/whatsapp/start`
2. **Scan QR:** `GET /api/whatsapp/qr`
3. **Send Message:** `POST /api/whatsapp/send` with `{ "phone": "123...", "message": "Hi" }`

---

### � Option B: Multi-User Workflow (4+ Persons Concurrency)

If 4 people need to use this without stepping on each other's toes, simply slide a `:sessionId` variable into the URL paths:

1. **Start Server (Person A):** `GET /api/whatsapp/personA/start`
2. **Scan QR (Person A):** `GET /api/whatsapp/personA/qr`
3. **Person B:** Person B can do the exact same thing independently using `/api/whatsapp/personB/start`! They will never overlap.

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

You can either hit the root `/api/whatsapp/...` (for default single-user), OR hit `/api/whatsapp/:sessionId/...` (for isolated multi-user mode). 

- **Start Client:** `GET /api/whatsapp/start`  *(or `/api/whatsapp/:sessionId/start`)*
- **Session Status:** `GET /api/whatsapp/status`
- **Get QR Code:** `GET /api/whatsapp/qr`
- **Request Pair Code:** `POST /api/whatsapp/pair { "phone": "98765..." }`
- **Send Msg:** `POST /api/whatsapp/send { "phone": "...", "message": "Hi" }`
- **Send Receipt (Base64 file):** `POST /api/whatsapp/send-receipt`
- **Fetch Chat History:** `GET /api/whatsapp/messages?phone=919876543210&limit=50`
- **Logout Client:** `POST /api/whatsapp/logout`
- **Emergency Session Wipe:** `POST /api/whatsapp/clear-all` (Wipes all sessions globally)
