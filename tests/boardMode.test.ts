import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { boardMode, stageFor, mouseToBoard, DEMO_PHOTO } from '../src/board/mode'

describe('boardMode', () => {
  it.each([
    ['', 'live'],
    ['?mirror=1', 'live'],
    ['?demo=1', 'demo'],
    ['?fixture=1', 'demo'],
    ['?demo=0', 'live'],
    ['?demo=1&mirror=1', 'demo'],
  ])('%s -> %s', (search, mode) => expect(boardMode(search)).toBe(mode))
})

describe('stageFor', () => {
  it('demo shows the saved photo with its saved boxes and never reads the camera board', () => {
    expect(stageFor('demo')).toEqual({ photo: DEMO_PHOTO, fixtureTerms: true, boardLoop: false, mirror: false })
    expect(existsSync(`public${DEMO_PHOTO}`)).toBe(true)
  })
  it('live shows the camera, reads the board, and never loads the saved boxes', () => {
    expect(stageFor('live', true)).toEqual({ photo: null, fixtureTerms: false, boardLoop: true, mirror: true })
    expect(stageFor('live', false).mirror).toBe(false)
  })
  it('demo ignores ?mirror=1 (the photo is never mirrored)', () => expect(stageFor('demo', true).mirror).toBe(false))
})

describe('mouseToBoard', () => {
  const rect = { left: 100, top: 50, width: 400, height: 225 }
  it('maps a point on the stage to board coordinates 0..1', () => {
    expect(mouseToBoard(300, 162.5, rect)).toEqual({ x: 0.5, y: 0.5 })
    expect(mouseToBoard(100, 50, rect)).toEqual({ x: 0, y: 0 })
  })
  it('returns null outside the stage', () => {
    expect(mouseToBoard(99, 100, rect)).toBeNull()
    expect(mouseToBoard(200, 276, rect)).toBeNull()
  })
})
