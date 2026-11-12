# QR & Barcode Studio

A lightweight browser app for generating and scanning QR codes and barcodes.

## Features
- Generate QR codes from text or URLs
- Generate barcodes from text or numbers
- Scan codes from the device camera
- Scan codes from uploaded images
- Theme switching between light and dark mode
- Local history saved in browser storage
- Works entirely in the browser using HTML, CSS, and JavaScript

## Tech Stack
- HTML
- CSS
- JavaScript
- QRCode.js
- JsBarcode

## Run locally
1. Clone the repository
2. Open `index.html` in a browser

For camera access, run the app from `localhost` or use HTTPS.

## Files
- `index.html` — app structure
- `styles.css` — UI styling and dark mode
- `app.js` — generation, scanning, theme, and local storage logic

## Notes
- User data is stored in `localStorage` on the browser only.
- Generated and scanned history is kept locally on the device.
