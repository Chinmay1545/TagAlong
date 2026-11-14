import { expect, test } from 'vitest'
import { MAX_DIST, TIP_BUFFER_MS } from '../src/core/config'

test('config constants', () => {
  expect(MAX_DIST).toBe(0.06)
  expect(TIP_BUFFER_MS).toBe(3000)
})
