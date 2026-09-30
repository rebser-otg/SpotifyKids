import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total, toGlobal, locate, prevTarget, nextTarget, skip, fmt } from './timeline.js';

const d = [10000, 20000, 30000]; // boundaries at 10 s and 30 s, total 60 s

test('total sums durations', () => {
  assert.equal(total(d), 60000);
  assert.equal(total([]), 0);
});

test('toGlobal adds previous tracks', () => {
  assert.equal(toGlobal(d, 0, 500), 500);
  assert.equal(toGlobal(d, 2, 1000), 31000);
});

test('toGlobal clamps an SDK position past the track end', () => {
  assert.equal(toGlobal(d, 0, 10400), 10000);
  assert.equal(toGlobal(d, 1, -5), 10000);
});

test('locate finds track and offset', () => {
  assert.deepEqual(locate(d, 0), { index: 0, offsetMs: 0 });
  assert.deepEqual(locate(d, 15000), { index: 1, offsetMs: 5000 });
  assert.deepEqual(locate(d, 59999), { index: 2, offsetMs: 29999 });
});

test('locate: exact boundary belongs to the later track', () => {
  assert.deepEqual(locate(d, 10000), { index: 1, offsetMs: 0 });
  assert.deepEqual(locate(d, 30000), { index: 2, offsetMs: 0 });
});

test('locate clamps to [0, total]', () => {
  assert.deepEqual(locate(d, -500), { index: 0, offsetMs: 0 });
  assert.deepEqual(locate(d, 60000), { index: 2, offsetMs: 30000 });
  assert.deepEqual(locate(d, 99999), { index: 2, offsetMs: 30000 });
});

test('locate round-trips with toGlobal', () => {
  for (const g of [0, 1, 9999, 10000, 25000, 59999]) {
    const { index, offsetMs } = locate(d, g);
    assert.equal(toGlobal(d, index, offsetMs), g);
  }
});

test('prevTarget: more than 3 s in → start of current track', () => {
  assert.equal(prevTarget(d, 14000), 10000);
});

test('prevTarget: 3 s or less in → start of previous track', () => {
  assert.equal(prevTarget(d, 13000), 0);
  assert.equal(prevTarget(d, 30000), 10000);
});

test('prevTarget on the first track → 0', () => {
  assert.equal(prevTarget(d, 2000), 0);
  assert.equal(prevTarget(d, 8000), 0);
});

test('prevTarget on a single-track album', () => {
  assert.equal(prevTarget([5000], 1000), 0);
  assert.equal(prevTarget([5000], 4000), 0);
});

test('nextTarget → start of next track, or total on the last track', () => {
  assert.equal(nextTarget(d, 0), 10000);
  assert.equal(nextTarget(d, 10000), 30000);
  assert.equal(nextTarget(d, 45000), 60000);
});

test('skip moves across tracks and clamps', () => {
  assert.equal(skip(d, 5000, 30000), 35000);
  assert.equal(skip(d, 35000, -30000), 5000);
  assert.equal(skip(d, 10000, -30000), 0);
  assert.equal(skip(d, 50000, 30000), 60000);
});

test('fmt formats minutes and hours', () => {
  assert.equal(fmt(0), '0:00');
  assert.equal(fmt(65000), '1:05');
  assert.equal(fmt(65999), '1:05');
  assert.equal(fmt(3723000), '1:02:03');
});
