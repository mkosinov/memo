import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it.each(['waiting', 'visited', 'missed', 'cancelled'] as const)(
    'renders %s with correct label',
    (status) => {
      render(<StatusBadge status={status} />);
      const labels: Record<string, string> = {
        waiting: 'Ожидание',
        visited: 'Посетил',
        missed: 'Неявка',
        cancelled: 'Отменён',
      };
      expect(screen.getByTestId(`status-badge-${status}`)).toHaveTextContent(labels[status]);
    }
  );
});
