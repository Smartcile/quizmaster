import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

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
    socket.on('connect', () => console.log('WebSocket connected'));
    socket.on('disconnect', () => console.log('WebSocket disconnected'));

    return () => socket.disconnect();
  }, []);

  return socketRef.current;
}
