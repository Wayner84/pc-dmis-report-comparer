# PC-DMIS Report Comparer — Browser Edition

## Goal

A public, static, browser-only application that compares 1–10 PC-DMIS PDF inspection reports without uploading report data.

## Required behaviour

- Accept 1–10 PDF reports by file picker and drag/drop.
- Process PDFs and OCR in the current browser tab; no report contents leave the device.
- Recognise standard PC-DMIS bitmap report tables with `AX / NOMINAL / +TOL / -TOL / MEAS / DEV / OUTTOL` columns.
- Align rows by report page, table/feature order, axis, and repeated-axis occurrence.
- Show feature, axis, nominal, lower/upper limits, each report actual, lot spread, mean, sample standard deviation, ±3 sigma, Cp/Cpu/Cpl/Cpk, sigma level, tolerance usage, capability rating, and inspection status.
- Use IN SPEC, OUT OF SPEC, and CHECK DATA states, plus CAPABLE, MARGINAL, NOT CAPABLE, and INSUFFICIENT DATA capability ratings.
- Draw a selectable capability chart below the table using nominal and specification limits, report readings, and red/yellow/green sigma bands; allow the chart to be saved as a PNG.
- Export the displayed comparison and capability values as Excel-friendly CSV.
- Keep the interface responsive, accessible, and usable on phones and desktops.
- Explain that OCR output must be reviewed before acceptance decisions.

## Architecture

- Static HTML/CSS/JavaScript deployed to GitHub Pages.
- PDF.js renders PDF pages locally.
- Tesseract.js performs OCR locally using WebAssembly.
- Pure parsing/comparison/CSV functions are isolated and covered by Node tests.
- Browser dependencies are vendored into the deployment build; the deployed app must not require report uploads or a private backend.

## Privacy and safety

- No analytics, accounts, cookies, report upload API, or server-side processing.
- Only static application assets and OCR language/model assets may be fetched.
- Files remain in browser memory and are discarded on refresh/close.
- UI must warn users to review CHECK DATA rows and source reports.

## Deployment

- Repository: `Wayner84/pc-dmis-report-comparer`
- Live app: `https://wayner84.github.io/pc-dmis-report-comparer/`
- Listed separately in `Wayner84/tools` as a Wayne-hosted engineering application.
