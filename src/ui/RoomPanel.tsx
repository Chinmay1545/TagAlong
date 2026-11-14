import { useRef } from 'react'
import { renderSVG } from 'uqr'
import type { RelayStatus } from '../live/relay'

const STATUS: Record<RelayStatus | 'off', string> = {
  open: 'phones · live', reconnecting: 'phones · reconnecting', connecting: 'phones · connecting', off: 'phones · connecting',
  closed: 'phones · open in another tab', // the server handed this room to a newer tab (close code 4001)
}

type Props = { name: string; joinUrl: string | null; listeners: number; relay: RelayStatus | 'off' }

export function RoomPanel({ name, joinUrl, listeners, relay }: Props) {
  // Each rise in the count bumps the key so the pulse animation restarts; a drop clears it.
  const seen = useRef({ n: listeners, bump: 0, rose: false })
  const c = seen.current
  if (listeners !== c.n) { c.rose = listeners > c.n; if (c.rose) c.bump++; c.n = listeners }
  return (
    <aside className="room-panel">
      {joinUrl ? (
        <>
          <div className="room-qr" role="img" aria-label={`QR code to join ${name}`} dangerouslySetInnerHTML={{ __html: renderSVG(joinUrl) }} />
          <div className="room-info">
            <div className="room-name">{name}</div>
            <div key={c.bump} className={`room-count mono${c.rose ? ' pulse' : ''}`}>{listeners} listening</div>
            <div className="room-status mono">{STATUS[relay]}</div>
          </div>
        </>
      ) : <div className="room-status mono">Phones offline</div>}
    </aside>
  )
}
