import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ io: vi.fn(), sock: { id: 's1', on: vi.fn(), disconnect: vi.fn() } }));
vi.mock('socket.io-client', () => ({ default: h.io }));

import { useWebSocket } from './useWebSocket.js';

beforeEach(() => {
  h.io.mockReset().mockReturnValue(h.sock);
  h.sock.on.mockReset();
  h.sock.disconnect.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('useWebSocket (quizzer)', () => {
  it('connects to the origin and returns the socket, disconnecting on unmount', async () => {
    const { result, unmount } = renderHook(() => useWebSocket());
    await waitFor(() => expect(result.current).toBe(h.sock));
    expect(h.io).toHaveBeenCalledWith(window.location.origin, expect.objectContaining({ path: '/socket.io' }));
    unmount();
    expect(h.sock.disconnect).toHaveBeenCalledOnce();
  });
});
