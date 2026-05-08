import assert from 'node:assert/strict';
import test from 'node:test';
import { hasLinkProductsForContentGeneration } from './pipelineService.js';

test('skips content generation when no link product was selected', () => {
  assert.equal(hasLinkProductsForContentGeneration([]), false);
  assert.equal(hasLinkProductsForContentGeneration(null), false);
});

test('allows content generation when at least one link product was selected', () => {
  assert.equal(hasLinkProductsForContentGeneration([{ id: 'selected-product' }]), true);
});
