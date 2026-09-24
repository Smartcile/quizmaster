import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../services/api', () => ({ loginAdmin: vi.fn() }));

import { loginAdmin } from '../services/api';
import Login from './Login.jsx';

beforeEach(() => loginAdmin.mockReset());
afterEach(cleanup);

describe('Login', () => {
  it('disables Sign In until a password is entered', () => {
    render(<Login onSuccess={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Enter password/i), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeEnabled();
  });

  it('calls onSuccess after a successful login', async () => {
    loginAdmin.mockResolvedValue({ token: 't' });
    const onSuccess = vi.fn();
    render(<Login onSuccess={onSuccess} />);
    fireEvent.change(screen.getByPlaceholderText(/Enter password/i), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));
    expect(await screen.findByRole('button', { name: /Sign In/i })).toBeInTheDocument();
    expect(loginAdmin).toHaveBeenCalledWith('admin');
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('shows the error and does not advance when something throws', async () => {
    loginAdmin.mockResolvedValue({ token: 't' });
    const onSuccess = vi.fn(() => { throw new Error('Invalid password'); });
    const user = userEvent.setup();
    render(<Login onSuccess={onSuccess} />);
    fireEvent.change(screen.getByPlaceholderText(/Enter password/i), { target: { value: 'bad' } });
    await user.click(screen.getByRole('button', { name: /Sign In/i }));
    expect(await screen.findByText('Invalid password')).toBeInTheDocument();
  });
});
