import { compareReports, exportComparisonCsv, parseOcrPage, parseOcrTable } from './src/parser.js';
import { updateEditableText } from './src/editor.js';

const $ = selector => document.querySelector(selector);
const MAX_FILES = 10;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_PAGES = 100;
let files = [];
let comparison = [];
let reportNames = [];
let editingLabels = false;

const drop = $('#drop');
$('#files').addEventListener('change', event => selectFiles([...event.target.files]));
for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => {
  event.preventDefault();
  drop.classList.add('active');
});
for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => {
  event.preventDefault();
  drop.classList.remove('active');
});
drop.addEventListener('drop', event => selectFiles([...event.dataTransfer.files]));

function selectFiles(candidates) {
  const pdfs = candidates.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  files = pdfs.filter(file => file.size <= MAX_FILE_BYTES).slice(0, MAX_FILES);
  const rejected = candidates.length - files.length;
  $('#file-summary').textContent = files.length
    ? `${files.length} report${files.length > 1 ? 's' : ''} selected: ${files.map(file => file.name).join(', ')}${rejected ? `. ${rejected} file(s) rejected by type, size, or the 10-report limit.` : ''}`
    : 'No valid PDF reports selected.';
  $('#compare').disabled = !files.length;
}

function uniqueNames(selectedFiles) {
  const counts = new Map();
  return selectedFiles.map(file => {
    const count = (counts.get(file.name) || 0) + 1;
    counts.set(file.name, count);
    return count === 1 ? file.name : `${file.name} (${count})`;
  });
}

function getPdfObject(page, objectId) {
  return new Promise((resolve, reject) => {
    try { page.objs.get(objectId, resolve); } catch (error) { reject(error); }
  });
}

function prepareTableCanvas(image) {
  const cropWidth = Math.max(1, Math.floor(image.width * 0.82));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = cropWidth;
  sourceCanvas.height = image.height;
  const sourceContext = sourceCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
  sourceContext.drawImage(image.bitmap || image, 0, 0, cropWidth, image.height, 0, 0, cropWidth, image.height);
  const pixels = sourceContext.getImageData(0, 0, cropWidth, image.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = Math.round(0.299 * pixels.data[index] + 0.587 * pixels.data[index + 1] + 0.114 * pixels.data[index + 2]);
    const value = gray < 105 ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    pixels.data[index + 3] = 255;
  }
  const lineRows = [];
  const sampleStep = Math.max(1, Math.floor(cropWidth / 1200));
  const sampledWidth = Math.ceil(cropWidth / sampleStep);
  for (let y = 0; y < image.height; y += 1) {
    let dark = 0;
    for (let x = 0; x < cropWidth; x += sampleStep) {
      if (pixels.data[(y * cropWidth + x) * 4] === 0) dark += 1;
    }
    if (dark > sampledWidth * 0.35) lineRows.push(y);
  }
  for (const y of lineRows) {
    for (let clearY = Math.max(0, y - 2); clearY < Math.min(image.height, y + 3); clearY += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const offset = (clearY * cropWidth + x) * 4;
        pixels.data[offset] = 255;
        pixels.data[offset + 1] = 255;
        pixels.data[offset + 2] = 255;
      }
    }
  }
  sourceContext.putImageData(pixels, 0, 0);

  const targetWidth = Math.min(1800, cropWidth);
  if (targetWidth === cropWidth) return sourceCanvas;
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = targetWidth;
  targetCanvas.height = Math.max(1, Math.round(image.height * targetWidth / cropWidth));
  const targetContext = targetCanvas.getContext('2d', { alpha: false });
  targetContext.imageSmoothingEnabled = false;
  targetContext.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
  return targetCanvas;
}

async function extractTableCanvases(pdfjs, page) {
  const operators = await page.getOperatorList();
  const canvases = [];
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    if (operators.fnArray[index] !== pdfjs.OPS.paintImageXObject) continue;
    const image = await getPdfObject(page, operators.argsArray[index][0]);
    if (!image || image.width < image.height * 2.5) continue;
    canvases.push(prepareTableCanvas(image));
  }
  return canvases;
}

$('#compare').addEventListener('click', async () => {
  const button = $('#compare');
  button.disabled = true;
  $('#results').hidden = true;
  let worker;
  try {
    const pdfjs = await import('./vendor/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
    const tesseractModule = await import('./vendor/tesseract.esm.min.js');
    const tesseract = tesseractModule.default || tesseractModule;
    worker = await tesseract.createWorker('eng', 1, {
      workerPath: './vendor/worker.min.js',
      corePath: './vendor/tesseract-core-simd-lstm.wasm.js',
      langPath: './vendor/lang',
      logger: event => {
        if (event.status && Number.isFinite(event.progress)) {
          $('#progress').textContent = `${event.status}: ${Math.round(event.progress * 100)}%`;
        }
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });

    const reports = {};
    reportNames = uniqueNames(files);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = reportNames[index];
      $('#progress').textContent = `Loading ${file.name} (${index + 1}/${files.length})…`;
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
      if (pdf.numPages > MAX_PAGES) throw new Error(`${file.name} exceeds the ${MAX_PAGES}-page safety limit.`);
      const rows = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const tableCanvases = await extractTableCanvases(pdfjs, page);
        if (tableCanvases.length) {
          for (let tableIndex = 0; tableIndex < tableCanvases.length; tableIndex += 1) {
            $('#progress').textContent = `OCR ${file.name}, page ${pageNumber}/${pdf.numPages}, table ${tableIndex + 1}/${tableCanvases.length}…`;
            const output = await worker.recognize(tableCanvases[tableIndex]);
            rows.push(...parseOcrTable(output.data.text, name, pageNumber, tableIndex + 1));
          }
        } else {
          const viewport = page.getViewport({ scale: 2.5 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d', { alpha: false });
          await page.render({ canvasContext: context, viewport, background: 'white' }).promise;
          $('#progress').textContent = `OCR ${file.name}, page ${pageNumber}/${pdf.numPages}…`;
          const output = await worker.recognize(canvas);
          rows.push(...parseOcrPage(output.data.text, name, pageNumber));
        }
        page.cleanup();
      }
      await pdf.cleanup();
      if (!rows.length) throw new Error(`No standard PC-DMIS measurement tables were recognised in ${file.name}.`);
      reports[name] = rows;
    }
    comparison = compareReports(reports);
    renderResults();
    $('#progress').textContent = 'Complete. Review CHECK DATA rows and the source reports.';
  } catch (error) {
    $('#progress').textContent = `Could not process reports: ${error.message}`;
  } finally {
    if (worker) await worker.terminate();
    button.disabled = !files.length;
  }
});

function appendCell(row, tag, text, className) {
  const cell = document.createElement(tag);
  cell.textContent = String(text);
  if (tag === 'th') cell.scope = row.parentElement?.tagName === 'THEAD' ? 'col' : 'row';
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function configureEditableCell(cell, rowIndex, field) {
  cell.setAttribute('data-editable-field', field);
  cell.dataset.rowIndex = String(rowIndex);
  cell.contentEditable = 'false';
  cell.addEventListener('input', () => {
    updateEditableText(comparison, rowIndex, field, cell.textContent);
  });
  cell.addEventListener('blur', () => {
    if (!updateEditableText(comparison, rowIndex, field, cell.textContent)) {
      cell.textContent = comparison[rowIndex][field];
    }
  });
}

function setEditingLabels(enabled) {
  editingLabels = enabled;
  const button = $('#edit-labels');
  button.setAttribute('aria-pressed', String(enabled));
  button.textContent = enabled ? 'Finish editing' : 'Edit feature/axis text';
  $('#edit-status').textContent = enabled
    ? 'Editing enabled. Select any feature or axis cell, type the correction, then choose Finish editing. Changes are included in CSV export.'
    : 'Feature and axis text is locked. Choose Edit to correct OCR text before export.';
  for (const cell of document.querySelectorAll('[data-editable-field]')) {
    cell.contentEditable = enabled ? 'plaintext-only' : 'false';
    if (enabled) {
      cell.tabIndex = 0;
      cell.setAttribute('role', 'textbox');
      cell.setAttribute('aria-label', `Edit ${cell.dataset.editableField} text`);
    } else {
      cell.removeAttribute('tabindex');
      cell.removeAttribute('role');
      cell.removeAttribute('aria-label');
    }
  }
}

$('#edit-labels').addEventListener('click', () => setEditingLabels(!editingLabels));

function format(value) {
  return value == null ? '—' : Number(value).toFixed(4);
}

function renderResults() {
  const header = document.createElement('tr');
  for (const heading of ['Feature', 'Axis', 'Nominal', 'Lower limit', 'Upper limit', ...reportNames, 'Lot spread', 'Status']) {
    appendCell(header, 'th', heading);
    header.lastElementChild.scope = 'col';
  }
  $('#thead').replaceChildren(header);

  const body = document.createDocumentFragment();
  comparison.forEach((result, rowIndex) => {
    const row = document.createElement('tr');
    const featureCell = appendCell(row, 'th', result.feature);
    featureCell.scope = 'row';
    configureEditableCell(featureCell, rowIndex, 'feature');
    const axisCell = appendCell(row, 'td', result.axis);
    configureEditableCell(axisCell, rowIndex, 'axis');
    appendCell(row, 'td', format(result.nominal));
    appendCell(row, 'td', format(result.lowerLimit));
    appendCell(row, 'td', format(result.upperLimit));
    for (const name of reportNames) appendCell(row, 'td', format(result.actuals[name]));
    appendCell(row, 'td', format(result.spread));
    appendCell(row, 'td', result.status, `status ${result.status.toLowerCase().replaceAll(' ', '-')}`);
    body.append(row);
  });
  $('#tbody').replaceChildren(body);
  setEditingLabels(false);
  $('#result-summary').textContent = `${comparison.length} aligned measurement rows · ${comparison.filter(row => row.status === 'CHECK DATA').length} require review`;
  $('#results').hidden = false;
}

$('#download').addEventListener('click', () => {
  const blob = new Blob([exportComparisonCsv(comparison, reportNames)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'pc-dmis-report-comparison.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});
