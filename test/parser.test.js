import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOcrTable, parseOcrPage, compareReports, exportComparisonCsv } from '../src/parser.js';

test('parses PC-DMIS OCR rows and repairs diameter axis', () => {
  const rows = parseOcrTable(`MM LOC1 - DATUM_A_CYL\nAX NOMINAL +TOL -TOL MEAS DEV OUTTOL\nX 0.000 0.050 0.050 0.048 0.048 0.000\n[ 36.190 0.030 0.000 36.212 0.022 0.000`, 'part.pdf', 1, 1);
  assert.equal(rows.length, 2); assert.equal(rows[0].feature, 'LOC1 - DATUM_A_CYL'); assert.equal(rows[1].axis, 'D');
});

test('repairs common browser OCR variants for PC-DMIS feature and Z axis', () => {
  const rows = parseOcrTable(`vm | oct - baum A on\nAX NOMINAL +TOL -TOL MEAS DEV OUTTOL\nE 0.000 0.050 0.050 0.046 0.046 0.000`, 'part.pdf', 1, 1);
  assert.equal(rows[0].axis, 'Z');
  assert.equal(rows[0].feature, 'LOC1 - DATUM A CYL');
  const diameter = parseOcrTable(`LOC1\nAX NOMINAL +TOL -TOL MEAS DEV OUTTOL\nE 36.190 0.030 0.000 36.212 0.022 0.000`, 'part.pdf', 1, 1);
  assert.equal(diameter[0].axis, 'D');
  const runout = parseOcrTable(`LOC1\nAX NOMINAL +TOL -TOL MEAS DEV OUTTOL\nR 0.000 0.050 0.000 0.014 0.014 0.000`, 'part.pdf', 1, 1);
  assert.equal(runout[0].axis, 'RN');
  const missingSign = parseOcrTable(`LOC16\nAX NOMINAL +TOL -TOL MEAS DEV OUTTOL\nZ -7.000 0.500 0.500 6.986 0.014 0.000`, 'part.pdf', 1, 1);
  assert.equal(missingSign[0].suspicious, true);
  assert.equal(compareReports({ a: missingSign, b: missingSign })[0].status, 'CHECK DATA');
});

test('parses multiple PC-DMIS tables from one OCR page', () => {
  const rows = parseOcrPage(`PC-DMIS report\nMM LOC1 - DATUM_A\nAX NOMINAL +TOL -TOL MEAS DEV OUTTOL\nX 0.000 0.050 0.050 0.048 0.048 0.000\nD 36.190 0.030 0.000 36.212 0.022 0.000\nMM DIST1 - WIDTH\nAX NOMINAL +TOL -TOL MEAS DEV OUTTOL\nM 2.500 0.100 0.100 2.476 -0.024 0.000\nFooter`, 'part.pdf', 1);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.feature), ['LOC1 - DATUM_A', 'LOC1 - DATUM_A', 'DIST1 - WIDTH']);
  assert.deepEqual(rows.map(row => row.table), [1, 1, 2]);
});

test('aligns repeated axes by occurrence and marks missing data', () => {
  const m = (source, axis, actual) => ({ source, page: 1, table: 1, feature: 'LOC1', axis, nominal: 0, plusTol: .1, minusTol: .1, actual });
  const rows = compareReports({ 'one.pdf': [m('one.pdf','X',.01), m('one.pdf','Z',.02)], 'two.pdf': [m('two.pdf','Z',.03)] });
  assert.equal(rows.find(r => r.axis === 'Z').actuals['one.pdf'], .02); assert.equal(rows.find(r => r.axis === 'Z').actuals['two.pdf'], .03);
  assert.equal(rows.find(r => r.axis === 'X').status, 'CHECK DATA');
});

test('exports Excel-friendly CSV with escaped fields', () => {
  const row = compareReports({ 'a.pdf': [{source:'a.pdf',page:1,table:1,feature:'DIST1, WIDTH',axis:'M',nominal:2.5,plusTol:.1,minusTol:.1,actual:2.476}] })[0];
  const csv = exportComparisonCsv([row], ['a.pdf']);
  assert.match(csv, /"DIST1, WIDTH"/); assert.match(csv, /IN SPEC/);
});
