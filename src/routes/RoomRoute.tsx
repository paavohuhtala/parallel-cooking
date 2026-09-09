import { useEffect } from 'react'
import { useLoaderData } from '@tanstack/react-router'
import App from '../App.tsx'
import type { RoomSummary } from '../shared/api.ts'
import { rememberRoom } from '../state/recent.ts'
import { StoreProvider } from '../state/store.tsx'

export default function RoomRoute() {
  const room = useLoaderData({ from: '/r/$roomId' }) as RoomSummary

  useEffect(() => {
    rememberRoom({ id: room.id, name: room.name })
  }, [room.id, room.name])

  return (
    <StoreProvider roomId={room.id}>
      <App />
    </StoreProvider>
  )
}
