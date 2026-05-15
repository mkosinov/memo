import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToastContainer } from '../app/components/toast/ToastContainer';
import { UIProvider, useUI } from '../contexts/UIContext';

function renderWithProvider() {
  return render(
    <UIProvider>
      <ToastContainer />
    </UIProvider>
  );
}

function renderWithToasts(messages: string[], undoCallbacks?: (() => void)[]) {
  function TestHarness() {
    const { showToast } = useUI();
    React.useEffect(() => {
      messages.forEach((msg, i) => {
        showToast(msg, undoCallbacks?.[i]);
      });
    }, []);
    return <ToastContainer />;
  }
  return render(
    <UIProvider>
      <TestHarness />
    </UIProvider>
  );
}

describe('ToastContainer', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = renderWithProvider();
    expect(container.firstChild).toBeNull();
  });

  it('renders toast message', () => {
    renderWithToasts(['Событие создано']);
    expect(screen.getByText('Событие создано')).toBeInTheDocument();
  });

  it('shows "Отменить" button when undo callback is provided', () => {
    renderWithToasts(['Событие удалено'], [() => {}]);
    expect(screen.getByText('Отменить')).toBeInTheDocument();
  });

  it('does not show "Отменить" button when no undo callback', () => {
    renderWithToasts(['Просто сообщение']);
    expect(screen.queryByText('Отменить')).not.toBeInTheDocument();
  });

  it('close button removes toast', () => {
    renderWithToasts(['Тест']);
    expect(screen.getByText('Тест')).toBeInTheDocument();
    const closeBtn = screen.getByRole('button', { name: 'Закрыть' });
    fireEvent.click(closeBtn);
    expect(screen.queryByText('Тест')).not.toBeInTheDocument();
  });

  it('undo button calls undo callback and removes toast', () => {
    const undoFn = vi.fn();
    renderWithToasts(['Удалено'], [undoFn]);
    expect(screen.getByText('Удалено')).toBeInTheDocument();
    const undoBtn = screen.getByText('Отменить');
    fireEvent.click(undoBtn);
    expect(undoFn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Удалено')).not.toBeInTheDocument();
  });

  it('limits visible toasts to 5', () => {
    renderWithToasts([
      'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
    ]);
    const toasts = screen.getAllByRole('status', { hidden: true });
    // Should only render last 5
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.queryByText('Two')).not.toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.getByText('Seven')).toBeInTheDocument();
  });
});
