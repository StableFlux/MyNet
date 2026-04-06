import { useEffect, useRef, useCallback } from 'react'

type MessageHandler = (data: Record<string, unknown>) => void

export function useWebSocket(onMessage: MessageHandler) {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || `ws://${window.location.host}/ws`
    ws.current = new WebSocket(wsUrl)

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessageRef.current(data)
      } catch {
        // ignore malformed messages
      }
    }

    ws.current.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.current.onerror = () => {
      ws.current?.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      ws.current?.close()
    }
  }, [connect])
}
