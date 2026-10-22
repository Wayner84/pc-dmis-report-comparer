# PC-DMIS Report Comparer

A browser-only static app for comparing 1–10 bitmap-based PC-DMIS PDF reports. PDF pages are rendered and OCR'd in the current browser tab. No report contents are uploaded, stored, tracked, or sent to an application server.

## Development

```sh
npm install
npm test
npm run build
npm run dev
```

`npm run dev` serves the repository for local browser testing. Open the printed URL, select or drop PDFs, and inspect OCR results before relying on them.

## Privacy and limitations

- Reports remain in browser memory and disappear on refresh/close.
- There are no analytics, accounts, cookies, upload APIs, or backend services.
- PDF.js and the Tesseract.js runtime are copied into `dist/vendor` during build. Tesseract language data may be fetched from its documented public CDN on first use; report contents are not sent there.
- OCR quality depends on scan resolution, table layout, and image clarity. The parser targets standard AX/NOMINAL/+TOL/-TOL/MEAS/DEV/OUTTOL tables.
- Always review CHECK DATA and source PDFs before inspection or acceptance decisions.

## Deployment

The `dist/` directory is a static site suitable for GitHub Pages. Configure the Pages workflow to publish `dist`; the application uses relative asset paths and works from a repository subpath.

## Verification

Run `npm test`, `npm run build`, `npm audit`, and `git diff --check` before publishing.
