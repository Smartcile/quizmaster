import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
  io: vi.fn(),
  sock: { id: 's1', on: vi.fn(), disconnect: vi.fn() },
}));

vi.mock('socket.io-client', () => ({ default: h.io }));
import { useWebSocket } from './useWebSocket.js';

beforeEach(() => {
  h.io.mockReset().mockReturnValue(h.sock);
  h.sock.on.mockReset();
  h.sock.disconnect.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('useWebSocket', () => {
  it('opens a socket to the current origin and exposes it once connected', async () => {
    const { result } = renderHook(() => useWebSocket());
    await waitFor(() => expect(result.current).toBe(h.sock));
    expect(h.io).toHaveBeenCalledWith(window.location.origin, expect.objectContaining({
      path: '/socket.io', reconnection: true, reconnectionAttempts: Infinity,
    }));
    const events = h.sock.on.mock.calls.map(c => c[0]);
    expect(events).toEqual(expect.arrayContaining(['connect', 'disconnect', 'connect_error']));
  });

  it('disconnects the socket on unmount', async () => {
    const { result, unmount } = renderHook(() => useWebSocket());
    await waitFor(() => expect(result.current).toBe(h.sock));
    unmount();
    expect(h.sock.disconnect).toHaveBeenCalledOnce();
  });
});
