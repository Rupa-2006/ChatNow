import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import * as authApi from '@/services/auth.api';
import { useAuthStore } from '@/store/authStore';
import type { Me } from '@/types/api';
import { ApiError } from '@/utils/errors';

const BOB: Me = {
  id: '22222222-2222-2222-2222-222222222222',
  username: 'bob_dev',
  displayName: 'Bob Smith',
  email: 'bob@example.com',
  avatarUrl: null,
  bio: null,
  isOnline: true,
  lastSeenAt: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  notificationPrefs: { browser: true, sound: true, messagePreview: true },
};

function renderWithRouter(initialEntry: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/chat" element={<div>Chat Dashboard Reached</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('Auth pages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ status: 'unauthenticated', user: null, bootstrapped: true });
  });

  it('shows validation errors on empty login submit', async () => {
    const user = userEvent.setup();
    renderWithRouter('/login');

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByText('Enter your email or username')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
  });

  it('submits valid login credentials and navigates to /chat', async () => {
    const user = userEvent.setup();
    const loginSpy = vi.spyOn(authApi, 'loginUser').mockResolvedValue({
      user: BOB,
      accessToken: 'jwt-bob',
    });

    renderWithRouter('/login');

    await user.type(screen.getByLabelText(/email or username/i), 'bob_dev');
    await user.type(screen.getByLabelText(/^password$/i), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(loginSpy).toHaveBeenCalledWith({
      identifier: 'bob_dev',
      password: 'correct horse battery',
    });
    expect(await screen.findByText('Chat Dashboard Reached')).toBeInTheDocument();
  });

  it('enforces 10-character password rule and displays backend conflict field errors on register', async () => {
    const user = userEvent.setup();
    vi.spyOn(authApi, 'registerUser').mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        message: 'An account with those details already exists',
        status: 409,
        details: [{ path: 'username', message: 'Username is already taken' }],
      }),
    );

    renderWithRouter('/register');

    await user.type(screen.getByLabelText(/display name/i), 'Bob Smith');
    await user.type(screen.getByLabelText(/username/i), 'bob_dev');
    await user.type(screen.getByLabelText(/email address/i), 'bob@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'short');
    await user.type(screen.getByLabelText(/confirm password/i), 'short');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();

    // Fix password to valid 10+ chars and trigger server 409 mapping
    const pwInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    await user.clear(pwInput);
    await user.clear(confirmInput);
    await user.type(pwInput, 'correct horse battery');
    await user.type(confirmInput, 'correct horse battery');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Username is already taken')).toBeInTheDocument();
  });
});
