import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintBytes, cacheParsedRows, getCachedRows } from '../src/processing.js';

test('fingerprints identical report bytes deterministically', async () => {
  assert.equal(await fingerprintBytes(new Uint8Array([1, 2, 3])), await fingerprintBytes(new Uint8Array([1, 2, 3])));
  assert.notEqual(await fingerprintBytes(new Uint8Array([1, 2, 3])), await fingerprintBytes(new Uint8Array([1, 2, 4])));
});

test('cached parsed rows are cloned with the requesting report source', async () => {
  const cache = new Map();
  const rows = [{ source: 'first.pdf', page: 1, table: 1, actual: 1 }];
  cacheParsedRows(cache, 'same', rows);
  const clone = getCachedRows(cache, 'same', 'second.pdf');
  assert.deepEqual(clone, [{ source: 'second.pdf', page: 1, table: 1, actual: 1 }]);
  assert.notEqual(clone[0], rows[0]);
});
