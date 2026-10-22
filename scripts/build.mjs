import { mkdir, rm, copyFile } from 'node:fs/promises';

const output = 'dist';
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/vendor/lang`, { recursive: true });
await mkdir(`${output}/src`, { recursive: true });

for (const file of ['index.html', 'app.css', 'app.js']) await copyFile(file, `${output}/${file}`);
await copyFile('src/parser.js', `${output}/src/parser.js`);

const assets = [
  ['node_modules/pdfjs-dist/build/pdf.mjs', 'vendor/pdf.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.mjs', 'vendor/pdf.worker.mjs'],
  ['node_modules/tesseract.js/dist/tesseract.esm.min.js', 'vendor/tesseract.esm.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'vendor/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'vendor/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'vendor/tesseract-core-simd-lstm.wasm'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'vendor/lang/eng.traineddata.gz'],
];
for (const [source, destination] of assets) await copyFile(source, `${output}/${destination}`);
await copyFile('LICENSE', `${output}/LICENSE`);
await copyFile('.nojekyll', `${output}/.nojekyll`);
console.log('Built fully local static PDF/OCR application in dist/.');
