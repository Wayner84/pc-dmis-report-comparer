# PC-DMIS Report Comparer

A browser-only static app for comparing 1–10 bitmap-based PC-DMIS PDF reports. PDF pages are rendered and OCR'd in the current browser tab. No report contents are uploaded, stored, tracked, or sent to an application server.

**Live app:** <https://wayner84.github.io/pc-dmis-report-comparer/>

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
- PDF.js, the Tesseract.js worker/core and English language data are all copied into `dist/vendor` during build. The deployed app needs no third-party runtime requests.
- OCR quality depends on scan resolution, table layout, and image clarity. The parser targets standard AX/NOMINAL/+TOL/-TOL/MEAS/DEV/OUTTOL tables.
- Always review CHECK DATA and source PDFs before inspection or acceptance decisions.

## Deployment

The `dist/` directory is a static site suitable for GitHub Pages. Configure the Pages workflow to publish `dist`; the application uses relative asset paths and works from a repository subpath.

## License

MIT — see [LICENSE](LICENSE).

## Verification

Run `npm test`, `npm run build`, `npm audit`, and `git diff --check` before publishing.
