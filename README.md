# PC-DMIS Report Comparer

A browser-only static app for comparing 1–20 bitmap-based PC-DMIS PDF reports. PDF pages are rendered and OCR'd in the current browser tab. No report contents are uploaded, stored, tracked, or sent to an application server.

Results appear in a two-axis scroll window with sticky headers and a frozen feature column. Use **Edit feature/axis text** to correct OCR labels before downloading the CSV. Measurements are globally aligned by axis, nominal and feature similarity, so a missed OCR row or changed page break remains a **CHECK DATA** gap instead of shifting later dimensions into the wrong comparison rows.

For each aligned measurement the app calculates lot spread, mean, sample standard deviation, ±3 sigma, Cp, Cpu, Cpl, Cpk, sigma level to the nearest specification limit, and percentage of the tolerance width consumed by six sigma. Selecting a result row updates the capability chart below the table; the chart shows nominal and specification limits, report readings, colour-coded sigma bands, and can be saved as a PNG.

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
- Capability values are estimates from the selected report lot using overall sample standard deviation. Cp/Cpk do not establish statistical control; time-ordered subgroup data and a suitable control chart are needed for that conclusion.

## Deployment

The `dist/` directory is a static site suitable for GitHub Pages. Configure the Pages workflow to publish `dist`; the application uses relative asset paths and works from a repository subpath.

## License

MIT — see [LICENSE](LICENSE).

## Verification

Run `npm test`, `npm run build`, `npm audit`, and `git diff --check` before publishing.
