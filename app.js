import { compareReports, exportComparisonCsv, parseOcrPage, parseOcrTable } from './src/parser.js';
import { updateEditableText } from './src/editor.js';
import { cacheParsedRows, fingerprintBytes, getCachedRows } from './src/processing.js';

const $ = selector => document.querySelector(selector);
const MAX_FILES = 20;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_PAGES = 100;
let files = [];
let comparison = [];
let reportNames = [];
let editingLabels = false;
let selectedCapabilityIndex = 0;

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
    ? `${files.length} report${files.length > 1 ? 's' : ''} selected: ${files.map(file => file.name).join(', ')}${rejected ? `. ${rejected} file(s) rejected by type, size, or the 20-report limit.` : ''}`
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
    const parsedRowsCache = new Map();
    const failures = [];
    reportNames = uniqueNames(files);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const name = reportNames[index];
      try {
        const bytes = await file.arrayBuffer();
        const fingerprint = await fingerprintBytes(bytes);
        const cachedRows = getCachedRows(parsedRowsCache, fingerprint, name);
        if (cachedRows) {
          reports[name] = cachedRows;
          $('#progress').textContent = `Reused OCR for identical report ${file.name} (${index + 1}/${files.length})…`;
          continue;
        }
        $('#progress').textContent = `Loading ${file.name} (${index + 1}/${files.length})…`;
        const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
        try {
          if (pdf.numPages > MAX_PAGES) throw new Error(`${file.name} exceeds the ${MAX_PAGES}-page safety limit.`);
          const rows = [];
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            try {
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
                canvas.width = 0;
                canvas.height = 0;
              }
            } finally {
              page.cleanup();
            }
          }
          if (!rows.length) throw new Error(`No standard PC-DMIS measurement tables were recognised in ${file.name}.`);
          cacheParsedRows(parsedRowsCache, fingerprint, rows);
          reports[name] = rows;
        } finally {
          await pdf.cleanup();
        }
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
        $('#progress').textContent = `Skipped ${file.name}: ${error.message}`;
      }
    }
    if (!Object.keys(reports).length) throw new Error(`No reports could be processed. ${failures.join(' | ')}`);
    comparison = compareReports(reports);
    renderResults();
    $('#progress').textContent = failures.length
      ? `Complete with ${failures.length} failed report${failures.length > 1 ? 's' : ''}: ${failures.join(' | ')}`
      : 'Complete. Review CHECK DATA rows and the source reports.';
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
    if (rowIndex === selectedCapabilityIndex) renderCapability(rowIndex);
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

function formatIndex(value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  return Number(value).toFixed(3);
}

function appendMetric(container, label, value, className = '') {
  const metric = document.createElement('div');
  metric.className = `metric ${className}`.trim();
  const strong = document.createElement('strong');
  strong.textContent = value;
  const caption = document.createElement('span');
  caption.textContent = label;
  metric.append(strong, caption);
  container.append(metric);
}

function drawCapabilityChart(result) {
  const canvas = $('#capability-chart');
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#17212b';
  context.font = '700 32px Inter, system-ui, sans-serif';
  context.fillText(`${result.feature} · ${result.axis}`, 60, 55);
  context.font = '20px Inter, system-ui, sans-serif';
  context.fillStyle = '#536471';
  context.fillText(`Nominal ${format(result.nominal)} · LSL ${format(result.lowerLimit)} · USL ${format(result.upperLimit)}`, 60, 88);

  const values = reportNames.map(name => result.actuals[name]).filter(Number.isFinite);
  const candidates = [result.lowerLimit, result.upperLimit, result.nominal, result.mean,
    result.minus3Sigma, result.plus3Sigma, ...values].filter(Number.isFinite);
  let minimum = Math.min(...candidates);
  let maximum = Math.max(...candidates);
  const specSpan = result.upperLimit - result.lowerLimit;
  const pad = Math.max(specSpan * 0.16, (maximum - minimum) * 0.12, 0.001);
  minimum -= pad;
  maximum += pad;
  if (maximum <= minimum) maximum = minimum + 1;
  const left = 85;
  const right = width - 65;
  const top = 205;
  const bottom = 445;
  const scale = value => left + (value - minimum) / (maximum - minimum) * (right - left);
  const fillRange = (start, end, colour) => {
    const x1 = scale(Math.max(minimum, start));
    const x2 = scale(Math.min(maximum, end));
    if (x2 > x1) {
      context.fillStyle = colour;
      context.fillRect(x1, top, x2 - x1, bottom - top);
    }
  };

  context.fillStyle = '#f8d7da';
  context.fillRect(left, top, right - left, bottom - top);
  fillRange(result.lowerLimit, result.upperLimit, '#f7fafc');
  if (Number.isFinite(result.standardDeviation) && result.standardDeviation > 0) {
    context.save();
    context.beginPath();
    context.rect(scale(result.lowerLimit), top, scale(result.upperLimit) - scale(result.lowerLimit), bottom - top);
    context.clip();
    fillRange(result.mean - 3 * result.standardDeviation, result.mean + 3 * result.standardDeviation, '#f6c9c7');
    fillRange(result.mean - 2 * result.standardDeviation, result.mean + 2 * result.standardDeviation, '#ffe3a3');
    fillRange(result.mean - result.standardDeviation, result.mean + result.standardDeviation, '#bfe8cb');
    context.restore();
  }

  context.strokeStyle = '#8b9aa5';
  context.lineWidth = 2;
  context.strokeRect(left, top, right - left, bottom - top);
  const drawLine = (value, colour, label, dash = []) => {
    if (!Number.isFinite(value)) return;
    const x = scale(value);
    context.save();
    context.strokeStyle = colour;
    context.lineWidth = 4;
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(x, top - 14);
    context.lineTo(x, bottom + 14);
    context.stroke();
    context.restore();
    context.fillStyle = colour;
    context.font = '700 17px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(label, x, top - 25);
    context.fillText(format(value), x, bottom + 42);
  };
  drawLine(result.lowerLimit, '#b42318', 'LSL');
  drawLine(result.upperLimit, '#b42318', 'USL');
  drawLine(result.nominal, '#b51d83', 'Nominal', [9, 7]);
  drawLine(result.mean, '#145da0', 'Mean', [3, 5]);

  context.textAlign = 'left';
  values.forEach((value, index) => {
    const x = scale(value);
    const y = 305 + ((index % 5) - 2) * 25;
    context.beginPath();
    context.fillStyle = '#17212b';
    context.arc(x, y, 7, 0, Math.PI * 2);
    context.fill();
  });

  context.font = '700 20px Inter, system-ui, sans-serif';
  context.fillStyle = '#17212b';
  context.fillText(`n=${result.sampleCount}`, 60, 135);
  context.fillText(`Std dev ${format(result.standardDeviation)}`, 185, 135);
  context.fillText(`Cp ${formatIndex(result.cp)}`, 455, 135);
  context.fillText(`Cpk ${formatIndex(result.cpk)}`, 610, 135);
  context.fillText(`Sigma level ${formatIndex(result.sigmaLevel)}`, 785, 135);
  context.fillStyle = result.rating === 'CAPABLE' ? '#16734c' : result.rating === 'MARGINAL' ? '#9a6700' : '#b42318';
  context.fillText(result.rating, 1015, 135);

  const legend = [
    ['#bfe8cb', 'within ±1σ'], ['#ffe3a3', '±1σ to ±2σ'], ['#f6c9c7', '±2σ to ±3σ'], ['#f8d7da', 'outside specification'],
  ];
  context.font = '16px Inter, system-ui, sans-serif';
  context.fillStyle = '#17212b';
  let legendX = 65;
  for (const [colour, label] of legend) {
    context.fillStyle = colour;
    context.fillRect(legendX, 535, 24, 18);
    context.strokeStyle = '#8b9aa5';
    context.strokeRect(legendX, 535, 24, 18);
    context.fillStyle = '#17212b';
    context.fillText(label, legendX + 32, 550);
    legendX += 270;
  }
  context.fillStyle = '#536471';
  context.fillText('Dots are the report results. Green/yellow/red bands show distance from the lot mean in standard deviations.', 65, 590);
}

function renderCapability(rowIndex) {
  const result = comparison[rowIndex];
  if (!result) return;
  selectedCapabilityIndex = rowIndex;
  for (const row of document.querySelectorAll('#tbody tr')) {
    const selected = Number(row.dataset.rowIndex) === rowIndex;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
  }
  $('#capability-summary').textContent = `${result.feature} · ${result.axis} · ${result.sampleCount} result${result.sampleCount === 1 ? '' : 's'} used`;
  const canvas = $('#capability-chart');
  canvas.setAttribute('aria-label', `Capability chart for ${result.feature}, axis ${result.axis}. Nominal ${format(result.nominal)}, lower limit ${format(result.lowerLimit)}, upper limit ${format(result.upperLimit)}, Cpk ${formatIndex(result.cpk)}, rating ${result.rating}.`);
  const metrics = $('#capability-metrics');
  metrics.replaceChildren();
  const ratingClass = result.rating.toLowerCase().replaceAll(' ', '-');
  appendMetric(metrics, 'Capability rating', result.rating, ratingClass);
  appendMetric(metrics, 'Lot mean', format(result.mean));
  appendMetric(metrics, 'Sample standard deviation', format(result.standardDeviation));
  appendMetric(metrics, '-3 sigma', format(result.minus3Sigma));
  appendMetric(metrics, '+3 sigma', format(result.plus3Sigma));
  appendMetric(metrics, 'Cp', formatIndex(result.cp));
  appendMetric(metrics, 'Cpu', formatIndex(result.cpu));
  appendMetric(metrics, 'Cpl', formatIndex(result.cpl));
  appendMetric(metrics, 'Cpk', formatIndex(result.cpk), ratingClass);
  appendMetric(metrics, 'Sigma level to nearest limit', formatIndex(result.sigmaLevel));
  appendMetric(metrics, 'Tolerance width used', result.toleranceUsedPercent == null ? '—' : `${formatIndex(result.toleranceUsedPercent)}%`);
  drawCapabilityChart(result);
}

function renderResults() {
  const header = document.createElement('tr');
  for (const heading of ['Feature', 'Axis', 'Nominal', 'Lower limit', 'Upper limit', ...reportNames, 'Lot spread',
    'Mean', 'Std dev', '-3σ', '+3σ', 'Cp', 'Cpu', 'Cpl', 'Cpk', 'Sigma level', 'Tolerance used', 'Capability', 'Status']) {
    appendCell(header, 'th', heading);
    header.lastElementChild.scope = 'col';
  }
  $('#thead').replaceChildren(header);

  const body = document.createDocumentFragment();
  comparison.forEach((result, rowIndex) => {
    const row = document.createElement('tr');
    row.dataset.rowIndex = String(rowIndex);
    row.tabIndex = 0;
    row.addEventListener('click', () => renderCapability(rowIndex));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        renderCapability(rowIndex);
      }
    });
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
    appendCell(row, 'td', format(result.mean));
    appendCell(row, 'td', format(result.standardDeviation));
    appendCell(row, 'td', format(result.minus3Sigma));
    appendCell(row, 'td', format(result.plus3Sigma));
    appendCell(row, 'td', formatIndex(result.cp));
    appendCell(row, 'td', formatIndex(result.cpu));
    appendCell(row, 'td', formatIndex(result.cpl));
    appendCell(row, 'td', formatIndex(result.cpk));
    appendCell(row, 'td', formatIndex(result.sigmaLevel));
    appendCell(row, 'td', result.toleranceUsedPercent == null ? '—' : `${formatIndex(result.toleranceUsedPercent)}%`);
    appendCell(row, 'td', result.rating, `status ${result.rating.toLowerCase().replaceAll(' ', '-')}`);
    appendCell(row, 'td', result.status, `status ${result.status.toLowerCase().replaceAll(' ', '-')}`);
    body.append(row);
  });
  $('#tbody').replaceChildren(body);
  setEditingLabels(false);
  $('#result-summary').textContent = `${comparison.length} aligned measurement rows · ${comparison.filter(row => row.status === 'CHECK DATA').length} require review`;
  renderCapability(comparison.findIndex(row => row.sampleCount >= 2) >= 0
    ? comparison.findIndex(row => row.sampleCount >= 2) : 0);
  $('#results').hidden = false;
}

$('#save-chart').addEventListener('click', () => {
  const result = comparison[selectedCapabilityIndex];
  if (!result) return;
  $('#capability-chart').toBlob(blob => {
    if (!blob) return;
    const safeName = `${result.feature}-${result.axis}`.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'measurement';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${safeName}-capability.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, 'image/png');
});

$('#download').addEventListener('click', () => {
  const blob = new Blob([exportComparisonCsv(comparison, reportNames)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'pc-dmis-report-comparison.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});
