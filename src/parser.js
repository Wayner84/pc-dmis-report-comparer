const NUMBER = '[-+]?(?:\\d+(?:[.,]\\d*)?|[.,]\\d+)';
const ROW = new RegExp(`^\\s*(\\S+)\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*$`);
const VALUES = new RegExp(`^\\s*(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})\\s*$`);
const VALID_AXES = new Set(['X', 'Y', 'Z', 'D', 'R', 'RN', 'A', 'M', 'PA', 'PR', 'I', 'J', 'K', 'L']);

const number = value => Number(String(value).replace(',', '.'));

function cleanAxis(raw, values, feature) {
  let result = (raw || '').toUpperCase().replace(/^[|:;,.(){}\[\]]+|[|:;,.(){}\[\]]+$/g, '');
  result = ({ '[': 'D', ']': 'D', '0': 'D', O: 'D', '1': 'I', M1: 'M' })[raw?.toUpperCase()] || result;
  if (result === 'E') return Math.abs(values[0]) >= 1 ? 'D' : 'Z';
  if (result === 'R' && Math.abs(values[0]) < 1e-9) return 'RN';
  if (!result && /AXIS/i.test(feature)) return 'M';
  if (!VALID_AXES.has(result)) {
    if (/^DIST/i.test(feature)) return 'M';
    if (/^ANGL/i.test(feature)) return 'A';
    if (Math.abs(values[0]) >= 1) return 'D';
  }
  return result;
}

function featureFrom(lines, headerIndex) {
  let title = lines.slice(0, headerIndex).map(line => line.trim()).filter(Boolean).pop() || '';
  title = title.replace(/^.*?\b(?:MM|DEG|INCH)\b[\s|J]*/i, '');
  const known = title.match(/\b(?:LOC\w*|OCT\w*|DIST\w*|BIST\w*|ANGL\w*|CONCEN\w*|CIRC\w*|CYLN\w*|FLAT\w*|PERP\w*|PARA\w*|POS\w*)/i);
  if (known) title = title.slice(known.index);
  return title.replace(/\s+/g, ' ').replace(/^[\s|_-]+|[\s|_-]+$/g, '')
    .replace(/^OCT\b/i, 'LOC1').replace(/^LOCI\b/i, 'LOC1').replace(/^DISTT\b/i, 'DIST1')
    .replace(/^BIST2\b/i, 'DIST2').replace(/^ANGLT\b/i, 'ANGL1')
    .replace(/\bBAUM\b/ig, 'DATUM').replace(/\bON$/i, 'CYL') || 'Unnamed feature';
}

export function parseOcrTable(text, source, page, table) {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => /NOMINAL/i.test(line) && /MEAS/i.test(line));
  if (headerIndex < 0) return [];
  const feature = featureFrom(lines, headerIndex);
  return lines.slice(headerIndex + 1).flatMap(line => {
    const cleaned = line.replace(/^\s*\|\s*/, '').trim().replace(/\|\s*$/, '').trim();
    const match = ROW.exec(cleaned);
    const valuesOnly = match ? null : VALUES.exec(cleaned);
    if (!match && !valuesOnly) return [];
    const rawAxis = match ? match[1] : '';
    const values = (match ? match.slice(2) : valuesOnly.slice(1)).map(number);
    if (values.some(value => !Number.isFinite(value))) return [];
    const suspicious = Math.abs((values[3] - values[0]) - values[4]) > 0.0021;
    return [{
      source, page, table, feature,
      axis: cleanAxis(rawAxis, values, feature),
      nominal: values[0], plusTol: Math.abs(values[1]), minusTol: Math.abs(values[2]),
      actual: values[3], deviation: values[4], outtol: values[5], suspicious,
    }];
  });
}

export function parseOcrPage(text, source, page) {
  const lines = text.split(/\r?\n/);
  const headers = lines.flatMap((line, index) => /NOMINAL/i.test(line) && /MEAS/i.test(line) ? [index] : []);
  return headers.flatMap((header, index) => {
    const previousHeader = index ? headers[index - 1] : -1;
    const nextHeader = headers[index + 1] ?? lines.length;
    const titleStart = Math.max(previousHeader + 1, header - 4);
    return parseOcrTable(lines.slice(titleStart, nextHeader).join('\n'), source, page, index + 1);
  });
}

export function compareReports(reports) {
  const names = Object.keys(reports);
  const maps = {};
  const order = [];
  const seen = new Set();
  for (const [name, rows] of Object.entries(reports)) {
    maps[name] = new Map();
    const occurrences = {};
    for (const row of rows) {
      const base = `${row.page}|${row.table}|${row.axis}`;
      const occurrence = occurrences[base] || 0;
      occurrences[base] = occurrence + 1;
      const key = `${base}|${occurrence}`;
      maps[name].set(key, row);
      if (!seen.has(key)) { seen.add(key); order.push(key); }
    }
  }
  return order.flatMap(key => {
    const present = names.filter(name => maps[name].has(key)).map(name => maps[name].get(key));
    if (!present.length) return [];
    const reference = present[0];
    const actuals = Object.fromEntries(names.map(name => [name, maps[name].get(key)?.actual ?? null]));
    const values = Object.values(actuals).filter(value => value !== null);
    const toleranceMatch = present.every(row => Math.abs(row.nominal - reference.nominal) < 1e-9
      && Math.abs(row.plusTol - reference.plusTol) < 1e-9
      && Math.abs(row.minusTol - reference.minusTol) < 1e-9);
    const complete = present.length === names.length;
    const dataReliable = present.every(row => !row.suspicious);
    const inSpec = toleranceMatch && complete && values.every(value => value >= reference.nominal - reference.minusTol - 1e-9
      && value <= reference.nominal + reference.plusTol + 1e-9);
    return [{
      ...reference,
      lowerLimit: reference.nominal - reference.minusTol,
      upperLimit: reference.nominal + reference.plusTol,
      actuals,
      spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : 0,
      status: !complete || !toleranceMatch || !dataReliable ? 'CHECK DATA' : inSpec ? 'IN SPEC' : 'OUT OF SPEC',
      inSpec,
      toleranceMatch,
    }];
  });
}

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function exportComparisonCsv(rows, names) {
  const header = ['Feature', 'Axis', 'Nominal', '+ tolerance', '- tolerance', 'Lower limit', 'Upper limit',
    ...names.map(name => `${name} actual`), 'Lot spread (max-min)', 'Status'];
  const data = rows.map(row => [row.feature, row.axis, row.nominal, row.plusTol, row.minusTol,
    row.lowerLimit, row.upperLimit, ...names.map(name => row.actuals[name]), row.spread, row.status]);
  return `\ufeff${[header, ...data].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
