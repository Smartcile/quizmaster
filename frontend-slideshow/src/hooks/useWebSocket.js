import { useState, useEffect } from 'react';
import io from 'socket.io-client';

export function useWebSocket() {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const sock = io(window.location.origin, {
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
      transports: ['websocket', 'polling']
    });

    sock.on('connect',       () => console.log('WS connected:', sock.id));
    sock.on('disconnect',    (reason) => console.log('WS disconnected:', reason));
    sock.on('connect_error', (err) => console.error('WS error:', err.message));

    setSocket(sock);

    return () => {
      sock.disconnect();
      setSocket(null);
    };
  }, []);

  return socket;
}
