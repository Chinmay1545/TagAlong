// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RoomPanel } from '../src/ui/RoomPanel'

afterEach(cleanup)
const url = 'https://x.test/c/abc?n=Math%20201'
describe('RoomPanel', () => {
  it('shows the count and the QR', () => {
    render(<RoomPanel name="Math 201" joinUrl={url} listeners={2} relay="open" />)
    expect(screen.getByText('2 listening')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'QR code to join Math 201' }).querySelector('svg')).toBeTruthy()
    expect(screen.getByText('phones · live')).toBeTruthy()
    expect(screen.getByText('Math 201')).toBeTruthy()
  })
  it('says Phones offline without a room', () => {
    render(<RoomPanel name="Math 201" joinUrl={null} listeners={0} relay="off" />)
    expect(screen.getByText('Phones offline')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
  it('pulses when the count goes up', () => {
    const { rerender } = render(<RoomPanel name="Math 201" joinUrl={url} listeners={0} relay="open" />)
    expect(screen.getByText('0 listening').className).not.toContain('pulse')
    rerender(<RoomPanel name="Math 201" joinUrl={url} listeners={1} relay="open" />)
    expect(screen.getByText('1 listening').className).toContain('pulse')
    rerender(<RoomPanel name="Math 201" joinUrl={url} listeners={0} relay="open" />)
    expect(screen.getByText('0 listening').className).not.toContain('pulse')
  })
  it('reconnecting status', () => {
    render(<RoomPanel name="Math 201" joinUrl={url} listeners={1} relay="reconnecting" />)
    expect(screen.getByText('phones · reconnecting')).toBeTruthy()
  })
})
