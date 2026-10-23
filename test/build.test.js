import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const requiredRuntimeAssets = [
  'dist/vendor/pdf.mjs',
  'dist/vendor/pdf.worker.mjs',
  'dist/vendor/tesseract.esm.min.js',
  'dist/vendor/worker.min.js',
  'dist/vendor/tesseract-core-simd-lstm.wasm.js',
  'dist/vendor/tesseract-core-simd-lstm.wasm',
  'dist/vendor/lang/eng.traineddata.gz',
  'dist/src/editor.js',
  'dist/src/processing.js',
  'dist/assets/tpl-logo-pink.png',
];

test('build vendors every PDF and OCR runtime asset', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs']);
  for (const path of requiredRuntimeAssets) await access(path);
});

test('browser app pins local workers, OCR core and language data', async () => {
  const source = await readFile('app.js', 'utf8');
  assert.match(source, /GlobalWorkerOptions\.workerSrc\s*=\s*['"]\.\/vendor\/pdf\.worker\.mjs['"]/);
  assert.match(source, /const tesseract = tesseractModule\.default \|\| tesseractModule/);
  assert.match(source, /workerPath:\s*['"]\.\/vendor\/worker\.min\.js['"]/);
  assert.match(source, /corePath:\s*['"]\.\/vendor\/tesseract-core-simd-lstm\.wasm\.js['"]/);
  assert.match(source, /langPath:\s*['"]\.\/vendor\/lang['"]/);
  assert.match(source, /sourceCanvas\.width\s*=\s*cropWidth/);
  assert.match(source, /targetWidth\s*=\s*Math\.min\(1800, cropWidth\)/);
  assert.match(source, /getOperatorList\(\)/);
  assert.match(source, /OPS\.paintImageXObject/);
  assert.match(source, /parseOcrTable/);
  assert.match(source, /await pdf\.cleanup\(\)/);
  assert.match(source, /fingerprintBytes/);
  assert.match(source, /Reused OCR for identical report/);
  assert.match(source, /Complete with .*failed report/);
  assert.doesNotMatch(source, /pdf\.destroy\(/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('results use a keyboard-focusable two-axis viewport with sticky headers', async () => {
  const html = await readFile('index.html', 'utf8');
  const css = await readFile('app.css', 'utf8');
  assert.match(html, /class="table-wrap"[^>]*id="table-viewport"[^>]*tabindex="0"/);
  assert.match(html, /aria-label="Scrollable comparison results"/);
  assert.match(css, /\.table-wrap\{[^}]*overflow:auto[^}]*max-height:/);
  assert.match(css, /thead th\{[^}]*position:sticky[^}]*top:0/);
  assert.match(css, /tbody th:first-child\{[^}]*position:sticky[^}]*left:0/);
  assert.match(css, /\.table-wrap:focus-visible/);
});

test('results expose an accessible label editor that updates the export model', async () => {
  const html = await readFile('index.html', 'utf8');
  const source = await readFile('app.js', 'utf8');
  assert.match(html, /id="edit-labels"[^>]*aria-pressed="false"/);
  assert.match(html, /id="edit-status"[^>]*aria-live="polite"/);
  assert.match(source, /import \{ updateEditableText \} from ['"]\.\/src\/editor\.js['"]/);
  assert.match(source, /data-editable-field/);
  assert.match(source, /contentEditable/);
  assert.match(source, /updateEditableText\(comparison/);
});

test('file selection and visible copy consistently allow up to 20 reports', async () => {
  const html = await readFile('index.html', 'utf8');
  const source = await readFile('app.js', 'utf8');
  assert.match(source, /const MAX_FILES = 20;/);
  assert.match(source, /20-report limit/);
  assert.match(html, /Compare up to 20 PDF inspection reports/);
  assert.match(html, /1–20 reports/);
  assert.doesNotMatch(html, /up to 10|1–10/);
});

test('development server implementation exists', async () => {
  await access('scripts/serve.mjs');
});
