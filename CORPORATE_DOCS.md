# 🏢 Corporate Whitepaper: WhatsApp API Microservice
**Version:** 1.0.0  
**Status:** Production Ready  
**Scope:** Internal Communication & Technical Integration  

---

## 1. Executive Summary
The **WhatsApp API Microservice** is a centralized hub designed to bridge the gap between internal business applications and the WhatsApp messaging platform. It allows multiple team members or automated systems to send messages, generate invoices, and manage customer interactions through a unified, high-performance API Gateway.

## 2. Problem Statement & Solution
### The Problem:
Previously, managing multiple WhatsApp connections required separate hardware or manual intervention, leading to fragmented communication, delivery delays, and lack of audit trails.

### The Solution:
Our microservice implements a **Multi-Session Architecture**. It provides:
- **Scalability:** Run multiple WhatsApp accounts from a single server instance.
- **Isolation:** Each user or department (e.g., Billing, Support, Marketing) has a completely private communication "pipe."
- **Automation:** Programmatic sending of bulk messages, receipts, and media.

---

## 3. Technical Architecture
The service is built on a modern, robust technology stack:
- **Node.js (LTS):** Core execution environment.
- **Express.js:** Unified API Gateway (RPC Pattern).
- **Puppeteer:** Headless browser engine for reliable WhatsApp Web protocol binding.
- **whatsapp-web.js:** Advanced library for deep platform interaction.

### 🔐 Unified Payload Gateway (RPC Layer)
Unlike traditional APIs with hundreds of URLs, we utilize a **Single Endpoint Architecture** at `POST /api/whatsapp`. Decisions are made based on the JSON `action` provided in the request body, making it easier for any frontend developer to integrate.

---

## 4. Key Feature Set
| Feature | Description |
| :--- | :--- |
| **Instant Boot** | Dynamically initialize NEW WhatsApp workers on-demand. |
| **Multi-Tenancy** | Switch between sessions (IDs) within a single request. |
| **Media Engine** | Send PDFs, Invoices, and Images via Base64 binary. |
| **Anti-Spam Throttling** | Automated message pacing to protect account health. |
| **Emergency Wipe** | Global reset button to clear all active sessions and local cache. |

---

## 5. Integration Guide (How to Use)
The microservice exposes a single entry point: `POST /api/whatsapp`.

### Step 1: Initialize a Session
Send a request to boot the background worker.
```json
{
  "action": "start",
  "sessionId": "billing_team"
}
```

### Step 2: Retrieve Authentication QR
Ask the service for the QR code to link your phone.
```json
{
  "action": "qr",
  "sessionId": "billing_team"
}
```

### Step 3: Send Communication
Dispatch automated alerts or documents.
```json
{
  "action": "send",
  "sessionId": "billing_team",
  "phone": "919000000000",
  "message": "Your corporate invoice is ready."
}
```

---

## 6. Deployment Strategy
To maintain the required 24/7 background socket connectivity, the service should be deployed as a **Persistent Node Instance**.

- **Recommended:** Railway.app, Render.com, or Amazon EC2.
- **Note on Vercel:** While supported via `vercel.json`, Vercel's serverless environment may hibernate background workers. For high-volume production, a persistent VPS or Docker container is advised.

### 🌐 Live Deployment Links
- **Production API:** [https://whatsapp-services-liart.vercel.app/](https://whatsapp-services-liart.vercel.app/)
- **Interactive Docs:** [https://whatsapp-services-liart.vercel.app/docs](https://whatsapp-services-liart.vercel.app/docs)

---

## 7. Operational Best Practices
- **Session Identification:** Use unique, descriptive IDs for `sessionId` (e.g., `dept_hr_notifications`).
- **Data Privacy:** Do not share API keys outside the organization.
- **Maintenance:** Periodically trigger `clear-all` during scheduled maintenance to purge local authentication artifacts.

---
**Prepared by:** Antigravity (Advanced Agentic Architecture)  
**For:** Internal Knowledge Distribution  
