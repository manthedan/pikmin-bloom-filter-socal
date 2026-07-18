import test from 'node:test';
import assert from 'node:assert/strict';
import { featureMatchesQuery, parseAppHash, pointInBbox } from '../public/app-core.js';

test('pointInBbox includes edges and rejects invalid/outside points', () => {
  const bbox = [-118.7, 33.52, -117.66, 34.35];
  assert.equal(pointInBbox(33.52, -118.7, bbox), true);
  assert.equal(pointInBbox(34.35, -117.66, bbox), true);
  assert.equal(pointInBbox(32.7, -117.1, bbox), false);
  assert.equal(pointInBbox(33.7, -118, null), false);
});

test('pointInBbox can require the full detector radius inside coverage', () => {
  const bbox = [-118.7, 33.52, -117.66, 34.35];
  assert.equal(pointInBbox(33.5201, -118, bbox, 100), false);
  assert.equal(pointInBbox(33.7, -118, bbox, 100), true);
  assert.equal(pointInBbox(33.7, -118, bbox, -1), false);
});

test('search matches loaded names independently of active decor filters', () => {
  const feature = { properties: { decors: ['Hotel'], searchHay: 'westin south coast plaza hotel' } };
  assert.equal(featureMatchesQuery(feature, new Set(['Cafe']), 'south coast plaza'), true);
  assert.equal(featureMatchesQuery(feature, new Set(['Cafe']), ''), false);
  assert.equal(featureMatchesQuery(feature, new Set(['Hotel']), ''), true);
});

test('parseAppHash accepts valid shared state', () => {
  assert.deepEqual(
    parseAppHash('#map=16/33.66/-117.90&decors=Cafe,Movie%20Theater&scan=33.67/-117.91'),
    {
      view: { z: 16, lat: 33.66, lng: -117.9 },
      decors: ['Cafe', 'Movie Theater'],
      scan: { lat: 33.67, lng: -117.91 },
    },
  );
});

test('parseAppHash rejects malformed coordinates and percent escapes', () => {
  assert.deepEqual(parseAppHash('#map=13//&scan=99/0&decors=Cafe,%E0%A4%A'), { decors: ['Cafe'] });
});
