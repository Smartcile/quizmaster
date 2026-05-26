import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

// Connect to same origin - nginx proxies /socket.io to backend container
export function useWebSocket() {
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
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
