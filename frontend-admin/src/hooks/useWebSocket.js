import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

function getSocketUrl() {
  const cfg = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
  if (cfg.WS_URL) return cfg.WS_URL;
  // If API_URL is a relative path (/api), use same origin for WebSocket
  if (cfg.API_URL && cfg.API_URL.startsWith('/')) return window.location.origin;
  return `${window.location.protocol}//${window.location.hostname}:5000`;
}

export function useWebSocket() {
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(getSocketUrl(), {
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;
    socket.on('connect', () => console.log('WebSocket connected:', socket.id));
    socket.on('disconnect', () => console.log('WebSocket disconnected'));
    socket.on('connect_error', (err) => console.error('WebSocket error:', err.message));

    return () => socket.disconnect();
  }, []);

  return socketRef.current;
}
