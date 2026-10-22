import test from 'node:test';
import assert from 'node:assert/strict';
import { updateEditableText } from '../src/editor.js';

test('updates only editable comparison text fields and trims the value', () => {
  const rows = [{ feature: 'LOC1 OCR', axis: 'E', nominal: 0 }];
  assert.equal(updateEditableText(rows, 0, 'feature', '  LOC1 - DATUM_A_CYL  '), true);
  assert.equal(updateEditableText(rows, 0, 'axis', ' Z '), true);
  assert.equal(rows[0].feature, 'LOC1 - DATUM_A_CYL');
  assert.equal(rows[0].axis, 'Z');
  assert.equal(updateEditableText(rows, 0, 'nominal', '999'), false);
  assert.equal(rows[0].nominal, 0);
});

test('rejects blank labels and invalid row indexes', () => {
  const rows = [{ feature: 'LOC1', axis: 'X' }];
  assert.equal(updateEditableText(rows, 0, 'feature', '   '), false);
  assert.equal(updateEditableText(rows, 4, 'feature', 'LOC4'), false);
  assert.equal(rows[0].feature, 'LOC1');
});
