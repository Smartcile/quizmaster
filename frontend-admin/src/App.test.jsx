import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./services/api', () => ({
  verifyAdminToken: vi.fn(),
  clearToken: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));
vi.mock('./pages/Login', () => ({ default: ({ onSuccess }) => <button onClick={onSuccess}>STUB_LOGIN</button> }));
vi.mock('./pages/Dashboard', () => ({ default: () => <div>STUB_DASHBOARD</div> }));
vi.mock('./pages/QuestionManager', () => ({ default: () => <div>STUB_QUESTIONS</div> }));
vi.mock('./pages/RoundBuilder', () => ({ default: () => <div>STUB_ROUNDS</div> }));
vi.mock('./pages/QuizBuilder', () => ({ default: () => <div>STUB_QUIZZES</div> }));
vi.mock('./pages/AnswerMarking', () => ({ default: () => <div>STUB_MARKING</div> }));
vi.mock('./pages/QuizControl', () => ({ default: () => <div>STUB_CONTROL</div> }));
vi.mock('./pages/MastersAndSlides', () => ({ default: () => <div>STUB_MASTERS</div> }));
vi.mock('./pages/QuizHistory', () => ({ default: () => <div>STUB_HISTORY</div> }));
vi.mock('./pages/MediaLibrary', () => ({ default: () => <div>STUB_MEDIA</div> }));
vi.mock('./pages/Settings', () => ({ default: () => <div>STUB_SETTINGS</div> }));

import { verifyAdminToken } from './services/api';
import App from './App.jsx';

beforeEach(() => verifyAdminToken.mockReset());
afterEach(cleanup);

describe('Admin App — auth gate + nav', () => {
  it('shows the login screen when the token is invalid', async () => {
    verifyAdminToken.mockResolvedValue(false);
    render(<App />);
    expect(await screen.findByText('STUB_LOGIN')).toBeInTheDocument();
  });

  it('enters the dashboard after login and navigates between pages', async () => {
    verifyAdminToken.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText('STUB_LOGIN'));

    expect(await screen.findByText('STUB_DASHBOARD')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Media' }));
    expect(screen.getByText('STUB_MEDIA')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText('STUB_HISTORY')).toBeInTheDocument();
  });

  it('skips login when a valid token is present', async () => {
    verifyAdminToken.mockResolvedValue(true);
    render(<App />);
    expect(await screen.findByText('STUB_DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('STUB_LOGIN')).not.toBeInTheDocument();
  });
});
