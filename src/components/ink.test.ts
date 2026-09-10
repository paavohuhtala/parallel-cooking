import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COOK_COLORS } from '../shared/apply.ts'
import { DARK_INK, LIGHT_INK, contrastRatio, inkOn } from './ink.ts'

test('contrast is measured the way WCAG measures it', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.equal(contrastRatio('#ffffff', '#000000'), 21)
  assert.equal(contrastRatio('#777777', '#777777'), 1)
})

test('every cook colour carries its initial at AA contrast', () => {
  // The badge text is 0.68rem, and 8px in the graph — nowhere near "large",
  // so it needs the full 4.5:1.
  for (const color of COOK_COLORS) {
    const ratio = contrastRatio(inkOn(color), color)
    assert.ok(ratio >= 4.5, `${color} with ${inkOn(color)} is ${ratio.toFixed(2)}:1`)
  }
})

test('the ink follows the fill, whichever way it needs to go', () => {
  assert.equal(inkOn('#d4a017'), DARK_INK) // mustard: white would be 2.4:1
  assert.equal(inkOn('#1f3a93'), LIGHT_INK)
  // Not something to crash a badge over.
  assert.equal(inkOn('rebeccapurple'), LIGHT_INK)
})
