import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

function getSocketUrl() {
  const cfg = (typeof window !== 'undefined' && window.APP_CONFIG) || {};
  if (cfg.WS_URL) return cfg.WS_URL;
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
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;
    socket.on('connect', () => console.log('WebSocket connected'));
    socket.on('disconnect', () => console.log('WebSocket disconnected'));

    return () => socket.disconnect();
  }, []);

  return socketRef.current;
}
