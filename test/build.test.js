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
  assert.doesNotMatch(source, /pdf\.destroy\(/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('development server implementation exists', async () => {
  await access('scripts/serve.mjs');
});
