<p align="center">
  <h1 align="center">💼 WhatsApp Bill Manager</h1>
  <p align="center">
    <strong>Generate GST invoices, manage bills, and authenticate users via WhatsApp — all from one dashboard.</strong>
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
- [Authentication](#-authentication)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Usage](#-usage)
- [API Reference](#-api-reference)
- [License](#-license)

---

## 🌟 Overview

**WhatsApp Bill Manager** is a comprehensive full-stack web application designed for small businesses and shopkeepers. It combines powerful invoice generation with seamless WhatsApp integration.

Key capabilities include:
- **WhatsApp Authentication**: Log in users using their mobile number and OTP sent via WhatsApp.
- **GST Invoicing**: Generate professional A4 and Thermal invoices with GST calculations.
- **Direct Sharing**: Send invoices as PDF documents directly to customers' WhatsApp.
- **API Integration**: Robust REST API with API Key authentication for external integrations.

---

## ✨ Features

### 🔐 Multi-Session Authentication
- **Mobile Login**: Secure login using 10-digit Indian mobile numbers.
- **WhatsApp OTP**: Verification codes sent directly to the user's WhatsApp.
- **Multi-Device Support**: Multiple users can be logged in simultaneously across different devices.
- **Session Management**: Secure, persistent sessions with auto-expiry.

### 📱 WhatsApp Integration
- **QR Code Connection**: Scan to link your business WhatsApp account.
- **Real-time Status**: Live connection monitoring (Connected/Disconnected/Reconnecting).
- **Auto-Reconnect**: Intelligent reconnection logic with exponential backoff.
- **Direct Messaging**: Send text messages and PDFs programmatically.

### 🧾 GST Invoice Generator
- **Professional Templates**: minimal, GST-compliant A4 layouts, and Thermal printer support.
- **Automatic Calculations**: Auto-calculates CGST, SGST, IGST, and Grand Totals.
- **Number to Words**: Automatically converts total amounts to words (Indian Rupee format).
- **Shop Settings**: Configure shop details, logo, signature, and banking information.
- **PDF Generation**: High-performance in-memory PDF generation using `pdfkit`.

### 🎨 Premium Dashboard
- **Glassmorphism UI**: Modern, dark-themed interface with backdrop blur effects.
- **Quick Shortcuts**: Easy access to WhatsApp, Bill Generator, and API docs.
- **Responsive**: Fully responsive design for mobile and desktop.

---

## 🔐 Authentication

The application features a built-in authentication system:

1. **Login**: Click the "Login 🔐" shortcut on the homepage.
2. **Enter Mobile**: Input your 10-digit mobile number and solve the captcha.
3. **Receive OTP**: A 6-digit OTP is sent to your WhatsApp number from the connected business account.
4. **Verify**: Enter the OTP to log in.
5. **Welcome**: You are redirected to a personalized welcome page (`/welcome.html`).
6. **Logout**: Click the "Logout 🚪" button to end the session.

> **Note**: The core dashboard pages are accessible publicly by default (as per configuration), but the auth system provides a secure layer for user identification.

---

## 🛠 Tech Stack

| Layer        | Technology                                                         |
| ------------ | ------------------------------------------------------------------ |
| **Runtime**  | [Node.js](https://nodejs.org/)                                     |
| **Server**   | [Express 5](https://expressjs.com/)                                |
| **WhatsApp** | [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)  |
| **PDF**      | [PDFKit](https://pdfkit.org/)                                      |
| **Auth**     | Custom OTP & Session Management (Cookies)                          |
| **Frontend** | Vanilla HTML5, CSS3 (Glassmorphism), JavaScript                    |
| **Storage**  | JSON Files (`bills.json`, `shop-settings.json`, `api-keys.json`)   |

---

## 📁 Project Structure

```
whatsapp-qr-bill/
├── public/                  # Static frontend files
│   ├── index.html           # Dashboard with Login shortcut
│   ├── login.html           # Authentication page (Login/Signup)
│   ├── welcome.html         # Post-login welcome page
│   ├── whatsapp.html        # WhatsApp connection manager
│   ├── invoice.html         # Advanced GST Invoice Generator
│   ├── bill.html            # Simple Bill Generator
│   └── api-docs.html        # API Documentation
├── .wwebjs_auth/            # WhatsApp session data
├── data/                    # JSON data storage (auto-created)
├── server.js                # Main Express server & Logic
└── README.md                # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** `v18+`
- **WhatsApp Account** (on your phone)

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

3. **Start the server**
   ```bash
   node server.js
   ```

4. **Access the App**
   Open **[http://localhost:5000](http://localhost:5000)** in your browser.

---

## 📡 API Reference

The application provides a robust REST API for integration.

### Authentication Headers
Most API endpoints require an API Key.
- Header: `X-API-Key: your_api_key`
- Query Param: `?api_key=your_api_key`

### Core Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/auth/send-otp` | Send login OTP via WhatsApp |
| `POST` | `/auth/verify-otp` | Verify OTP and create session |
| `GET` | `/qr` | Get WhatsApp Auth QR code |
| `POST` | `/disconnect` | Disconnect WhatsApp session |
| `POST` | `/api/v1/send-message` | Send text message (Requires API Key) |
| `POST` | `/api/v1/send-invoice` | Send invoice PDF (Requires API Key) |
| `GET` | `/api/v1/invoices/:id/pdf` | Download invoice PDF |

For full documentation, visit **[http://localhost:5000/api/docs](http://localhost:5000/api/docs)**.

---

## 📄 License

This project is licensed under the **ISC License**.

---

<p align="center">
  <sub>Built with ❤️ using Node.js & WhatsApp Web.js</sub>
</p>
