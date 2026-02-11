<p align="center">
  <h1 align="center">💼 WhatsApp Bill Manager</h1>
  <p align="center">
    <strong>Generate invoices & share them as PDFs directly via WhatsApp — all from one dashboard.</strong>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
    <img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp" />
    <img src="https://img.shields.io/badge/PDFKit-CC0000?style=for-the-badge&logo=adobe&logoColor=white" alt="PDFKit" />
    <img src="https://img.shields.io/badge/License-ISC-blue?style=for-the-badge" alt="License" />
  </p>
</p>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Application](#running-the-application)
- [Usage](#-usage)
- [API Reference](#-api-reference)
- [Configuration](#-configuration)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**WhatsApp Bill Manager** is a full-stack web application that lets you connect to WhatsApp via QR code, generate professional invoices, and send them as PDF documents directly to your customers' WhatsApp — all without saving any files to disk.

Built with a sleek, modern glassmorphism UI and powered by `whatsapp-web.js`, this tool is perfect for small businesses, freelancers, and shopkeepers who want a quick and elegant way to bill their customers.

---

## ✨ Features

### 📱 WhatsApp Integration
- **QR Code Authentication** — Scan once to connect your WhatsApp account
- **Real-time Connection Status** — Live status updates (Connected / Connecting / Reconnecting / Disconnected)
- **Auto-Reconnect** — Exponential backoff reconnection with configurable retry delays
- **Send Text Messages** — Direct messaging to any Indian WhatsApp number
- **Manual Disconnect & Re-pair** — Cleanly destroy sessions and re-authenticate

### 🧾 Invoice / Bill Generation
- **Create Professional Invoices** — Auto-generated invoice numbers (`INV-YYMMDD-XXX`)
- **Multi-Item Support** — Add unlimited line items with quantity and price
- **Real-time Preview** — Instant invoice preview before sending
- **Invoice History** — Browse all previously generated invoices
- **JSON Persistence** — Bills stored locally in `bills.json`

### 📤 PDF Sharing via WhatsApp
- **In-Memory PDF Generation** — PDFs are generated using `pdfkit` entirely in memory (no temp files)
- **Direct WhatsApp Delivery** — Send the PDF as a WhatsApp media message with a formatted caption
- **Professional PDF Layout** — Clean, formatted invoices with header, itemized table, and grand total

### 🎨 Premium UI/UX
- **Glassmorphism Design** — Frosted glass cards with backdrop blur effects
- **Dark Mode** — Elegant deep blue gradient backgrounds
- **Micro-Animations** — Smooth transitions, hover effects, and staggered card animations
- **Responsive Layout** — Works beautifully on desktop and mobile devices
- **Toast Notifications** — Non-intrusive success/error feedback

---

## 🛠 Tech Stack

| Layer        | Technology                                                         |
| ------------ | ------------------------------------------------------------------ |
| **Runtime**  | [Node.js](https://nodejs.org/)                                     |
| **Server**   | [Express 5](https://expressjs.com/)                                |
| **WhatsApp** | [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)  |
| **PDF**      | [PDFKit](https://pdfkit.org/)                                      |
| **QR Code**  | [qrcode](https://www.npmjs.com/package/qrcode)                     |
| **Frontend** | Vanilla HTML, CSS, JavaScript                                      |
| **Storage**  | JSON file (`bills.json`)                                           |

---

## 📁 Project Structure

```
whatsapp-qr-bill/
├── public/                  # Static frontend files
│   ├── index.html           # Landing page with navigation cards
│   ├── whatsapp.html        # WhatsApp connection & messaging page
│   └── bill.html            # Bill generator & invoice preview page
├── .wwebjs_auth/            # WhatsApp session data (auto-generated)
├── .wwebjs_cache/           # Puppeteer browser cache (auto-generated)
├── bills.json               # Persistent invoice storage
├── server.js                # Express server — API routes, WhatsApp client, PDF generation
├── package.json             # Project metadata & dependencies
└── README.md                # You are here!
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** `v18+` — [Download here](https://nodejs.org/)
- **Google Chrome / Chromium** — Required by Puppeteer (used internally by `whatsapp-web.js`)
- A **WhatsApp account** to link via QR code

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/whatsapp-qr-bill.git
   cd whatsapp-qr-bill
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

### Running the Application

```bash
node server.js
```

The server will start on **[http://localhost:5000](http://localhost:5000)**.

Open the URL in your browser to access the dashboard.

---

## 💡 Usage

### 1. Connect WhatsApp
1. Navigate to the **WhatsApp** page from the landing screen
2. Wait for the QR code to appear
3. Open **WhatsApp** on your phone → **Linked Devices** → **Link a Device**
4. Scan the QR code displayed on screen
5. Once connected, the status badge will turn **🟢 Connected**

### 2. Generate a Bill
1. Navigate to the **Bill Generator** page
2. Enter the **Customer Name** and **Phone Number**
3. Add line items with **Name**, **Quantity**, and **Price**
4. Click **🧾 Generate Invoice**
5. Preview the generated invoice on the right panel

### 3. Share via WhatsApp
1. After generating an invoice, click **📤 Share as PDF via WhatsApp**
2. A professional PDF will be generated in-memory and sent to the customer's WhatsApp
3. The customer receives the PDF with a formatted caption including the total amount

---

## 📡 API Reference

### WhatsApp

| Method | Endpoint       | Description                              |
| ------ | -------------- | ---------------------------------------- |
| `GET`  | `/qr`          | Get QR code data, connection status      |
| `POST` | `/send`        | Send a text message to a phone number    |
| `POST` | `/disconnect`  | Manually disconnect & reset the session  |

### Bills

| Method | Endpoint       | Description                              |
| ------ | -------------- | ---------------------------------------- |
| `GET`  | `/bills`       | Retrieve all generated invoices          |
| `POST` | `/bills`       | Create a new invoice                     |
| `POST` | `/send-bill`   | Send an invoice as PDF via WhatsApp      |

### Health

| Method | Endpoint       | Description                              |
| ------ | -------------- | ---------------------------------------- |
| `GET`  | `/health`      | Server & WhatsApp status check           |

#### Example — Create a Bill

```bash
curl -X POST http://localhost:5000/bills \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Rajesh Kumar",
    "customerPhone": "9876543210",
    "items": [
      { "name": "Rice 5kg", "qty": 2, "price": 350 },
      { "name": "Sugar 1kg", "qty": 1, "price": 45 }
    ]
  }'
```

#### Example — Send Invoice PDF

```bash
curl -X POST http://localhost:5000/send-bill \
  -H "Content-Type: application/json" \
  -d '{ "invoiceNumber": "INV-260211-042" }'
```

---

## ⚙️ Configuration

| Constant               | Default   | Description                                      |
| ---------------------- | --------- | ------------------------------------------------ |
| `MAX_RECONNECT_DELAY`  | `30000`   | Maximum delay (ms) between reconnection attempts |
| `BASE_RECONNECT_DELAY` | `5000`    | Base delay (ms), doubles on each attempt         |
| Server Port            | `5000`    | Express server listening port                    |

> These values can be modified directly in `server.js`.

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

---

## 📄 License

This project is licensed under the **ISC License**. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <sub>Built with ❤️ using Node.js & WhatsApp Web.js</sub>
</p>
