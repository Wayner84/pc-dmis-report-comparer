import { calculateCapability } from './capability.js';

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

function normalisedFeature(feature) {
  return String(feature || '').toUpperCase().match(/[A-Z0-9]+/g)?.join(' ') || '';
}

function featureSimilarity(left, right) {
  const a = normalisedFeature(left);
  const b = normalisedFeature(right);
  if (!a.length && !b.length) return 1;
  const previous = new Uint16Array(b.length + 1);
  const current = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = 0;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    previous.set(current);
  }
  return previous[b.length] / Math.max(a.length, b.length);
}

function alignmentMatchScore(left, right) {
  if (left.axis !== right.axis || Math.abs(left.nominal - right.nominal) >= 1e-9) return null;
  return 10 + featureSimilarity(left.feature, right.feature) * 4;
}

function alignMeasurementSequences(existing, incoming) {
  const gapPenalty = -3;
  const scores = Array.from({ length: existing.length + 1 }, () => new Float64Array(incoming.length + 1));
  const moves = Array.from({ length: existing.length + 1 }, () => new Uint8Array(incoming.length + 1));
  for (let i = 1; i <= existing.length; i += 1) { scores[i][0] = scores[i - 1][0] + gapPenalty; moves[i][0] = 2; }
  for (let j = 1; j <= incoming.length; j += 1) { scores[0][j] = scores[0][j - 1] + gapPenalty; moves[0][j] = 3; }

  for (let i = 1; i <= existing.length; i += 1) {
    for (let j = 1; j <= incoming.length; j += 1) {
      const matchScore = alignmentMatchScore(existing[i - 1], incoming[j - 1]);
      const match = matchScore === null ? -Infinity : scores[i - 1][j - 1] + matchScore;
      const skipExisting = scores[i - 1][j] + gapPenalty;
      const skipIncoming = scores[i][j - 1] + gapPenalty;
      const best = Math.max(match, skipExisting, skipIncoming);
      scores[i][j] = best;
      moves[i][j] = match === best ? 1 : skipExisting === best ? 2 : 3;
    }
  }

  const alignment = [];
  let i = existing.length;
  let j = incoming.length;
  while (i || j) {
    const move = moves[i][j];
    if (move === 1) { alignment.push([i - 1, j - 1]); i -= 1; j -= 1; }
    else if (move === 2) { alignment.push([i - 1, null]); i -= 1; }
    else if (move === 3) { alignment.push([null, j - 1]); j -= 1; }
    else throw new Error('Measurement alignment did not make progress.');
  }
  return alignment.reverse();
}

export function compareReports(reports) {
  const names = Object.keys(reports);
  if (!names.length) return [];
  let slots = reports[names[0]].map(row => ({ [names[0]]: row }));
  for (const name of names.slice(1)) {
    const incoming = reports[name];
    const representatives = slots.map(slot => Object.values(slot)[0]);
    slots = alignMeasurementSequences(representatives, incoming).map(([existingIndex, incomingIndex]) => {
      if (existingIndex === null) return { [name]: incoming[incomingIndex] };
      const slot = { ...slots[existingIndex] };
      if (incomingIndex !== null) slot[name] = incoming[incomingIndex];
      return slot;
    });
  }
  return slots.flatMap(slot => {
    const present = names.filter(name => slot[name]).map(name => slot[name]);
    if (!present.length) return [];
    const reference = present[0];
    const actuals = Object.fromEntries(names.map(name => [name, slot[name]?.actual ?? null]));
    const values = Object.values(actuals).filter(value => value !== null);
    const toleranceMatch = present.every(row => Math.abs(row.nominal - reference.nominal) < 1e-9
      && Math.abs(row.plusTol - reference.plusTol) < 1e-9
      && Math.abs(row.minusTol - reference.minusTol) < 1e-9);
    const complete = present.length === names.length;
    const dataReliable = present.every(row => !row.suspicious);
    const inSpec = toleranceMatch && complete && values.every(value => value >= reference.nominal - reference.minusTol - 1e-9
      && value <= reference.nominal + reference.plusTol + 1e-9);
    const capability = calculateCapability(values, reference.nominal,
      reference.nominal - reference.minusTol, reference.nominal + reference.plusTol);
    return [{
      ...reference,
      lowerLimit: reference.nominal - reference.minusTol,
      upperLimit: reference.nominal + reference.plusTol,
      actuals,
      spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : 0,
      ...capability,
      status: !complete || !toleranceMatch || !dataReliable ? 'CHECK DATA' : inSpec ? 'IN SPEC' : 'OUT OF SPEC',
      inSpec,
      toleranceMatch,
    }];
  });
}

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
export function exportComparisonCsv(rows, names) {
  const header = ['Feature', 'Axis', 'Nominal', '+ tolerance', '- tolerance', 'Lower limit', 'Upper limit',
    ...names.map(name => `${name} actual`), 'Lot spread (max-min)', 'Mean', 'Standard deviation', '-3 sigma', '+3 sigma',
    'Cp', 'Cpu', 'Cpl', 'Cpk', 'Sigma level', 'Tolerance used (%)', 'Capability rating', 'Status'];
  const data = rows.map(row => [row.feature, row.axis, row.nominal, row.plusTol, row.minusTol,
    row.lowerLimit, row.upperLimit, ...names.map(name => row.actuals[name]), row.spread, row.mean,
    row.standardDeviation, row.minus3Sigma, row.plus3Sigma, row.cp, row.cpu, row.cpl, row.cpk,
    row.sigmaLevel, row.toleranceUsedPercent, row.rating, row.status]);
  return `\ufeff${[header, ...data].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
