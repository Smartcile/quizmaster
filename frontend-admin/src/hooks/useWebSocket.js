import { useState, useEffect } from 'react';
import io from 'socket.io-client';

// Returns the socket as React state so consuming components re-render when it
// becomes available. Previously returned socketRef.current which is always null
// on first render and never triggers a re-render when the socket connects.
export function useWebSocket() {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const sock = io(window.location.origin, {
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,  // keep retrying — server state survives outages
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
