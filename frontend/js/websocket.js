import { setConnectionStatus } from './hud.js'

/**
 * Connect to the backend WebSocket and call onState(state) on every message.
 * Reconnects automatically with exponential backoff (1s → 2s → … → 30s cap).
 * Sends a 'ping' every 30s to keep the connection alive on Render free tier
 * (which drops idle WebSocket connections after ~55 seconds).
 *
 * @param {string}   url     - WebSocket URL, e.g. 'ws://localhost:8000/ws'
 * @param {Function} onState - called with parsed VehicleState on each message
 * @returns {{ send: (msg: string) => void }}
 */
export function connectWebSocket(url, onState) {
  let ws             = null
  let reconnectDelay = 1000   // ms; doubles on each failure, capped at 30 000
  let reconnectTimer = null
  let pingInterval   = null

  function connect() {
    setConnectionStatus('connecting')

    ws = new WebSocket(url)

    ws.onopen = () => {
      setConnectionStatus('connected')
      reconnectDelay = 1000   // reset backoff on success

      // Keep-alive ping every 30s
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 30_000)
    }

    ws.onmessage = event => {
      try {
        const state = JSON.parse(event.data)
        onState(state)
      } catch (e) {
        console.warn('[WS] Failed to parse state message:', e)
      }
    }

    ws.onclose = () => {
      setConnectionStatus('disconnected')
      clearInterval(pingInterval)
      reconnectTimer = setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
    }

    ws.onerror = () => {
      // onerror is always followed by onclose — just close to trigger reconnect
      ws.close()
    }
  }

  connect()

  return {
    send: msg => ws?.readyState === WebSocket.OPEN && ws.send(msg),
  }
}
