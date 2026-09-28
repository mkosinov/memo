/**
 * Static success screen of the public password setup (GH #348 Task 8,
 * spec §6): «Пароль установлен, войдите с телефоном и новым паролем» + the
 * «Войти» button → /login. A separate public address — refreshing it can
 * never re-issue the setup request (the fragment is long gone and the
 * token is consumed).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import PasswordSetupSuccessPage from '../app/password-setup/success/page';

describe('PasswordSetupSuccessPage', () => {
  it('shows the success message', () => {
    render(<PasswordSetupSuccessPage />);
    expect(screen.getByText('Пароль установлен')).toBeInTheDocument();
    expect(
      screen.getByText('Войдите с телефоном и новым паролем'),
    ).toBeInTheDocument();
  });

  it('links to the login page with a «Войти» button', () => {
    render(<PasswordSetupSuccessPage />);
    const loginLink = screen.getByRole('link', { name: 'Войти' });
    expect(loginLink).toHaveAttribute('href', '/login');
  });
});
