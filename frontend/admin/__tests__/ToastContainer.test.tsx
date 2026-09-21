import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { ToastContainer } from '../app/components/toast/ToastContainer';
import { UIProvider, useUI, type ToastKind } from '../contexts/UIContext';

function renderWithProvider() {
  return render(
    <UIProvider>
      <ToastContainer />
    </UIProvider>
  );
}

function renderWithToasts(messages: string[], undoCallbacks?: (() => void)[]) {
  return renderWithToastSpecs(messages.map((message) => ({ message, kind: 'info' as ToastKind })), undoCallbacks);
}

function renderWithToastSpecs(
  specs: { message: string; kind: ToastKind }[],
  undoCallbacks?: (() => void)[],
  countdownMs?: number
) {
  function TestHarness() {
    const { showToast } = useUI();
    React.useEffect(() => {
      specs.forEach((spec, i) => {
        showToast(spec.message, spec.kind, undoCallbacks?.[i], countdownMs);
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

// #285 D4 (rev8): non-undo toasts can carry a custom action button slot.
function renderWithActionToast(action: { label: string; onAction: () => void }) {
  function TestHarness() {
    const { showToast } = useUI();
    React.useEffect(() => {
      showToast('Не удалось удалить: данные изменились', 'error', undefined, undefined, action);
    }, []);
    return <ToastContainer />;
  }
  return render(
    <UIProvider>
      <TestHarness />
    </UIProvider>
  );
}

// #330 §5.3: persistent toast — no × button, not evicted by the last-5 slice.
function renderWithPersistentToast(queueMessages: string[] = []) {
  function TestHarness() {
    const { showToast } = useUI();
    React.useEffect(() => {
      queueMessages.forEach((message) => showToast(message));
      showToast('Нет соединения с сервером. Обновления приостановлены.', 'error', undefined, undefined, undefined, true);
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

  it('keeps loading toast visible alongside last 5 regular toasts (D5a)', () => {
    renderWithToastSpecs([
      { message: 'One', kind: 'info' },
      { message: 'Two', kind: 'info' },
      { message: 'Three', kind: 'info' },
      { message: 'Four', kind: 'info' },
      { message: 'Five', kind: 'info' },
      { message: 'Six', kind: 'info' },
      { message: 'Seven', kind: 'info' },
      { message: 'Сохраняем…', kind: 'loading' },
    ]);
    // only the last 5 regular toasts are rendered
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.queryByText('Two')).not.toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.getByText('Seven')).toBeInTheDocument();
    // loading toast is never pushed out of the stack
    expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    expect(screen.getByText('Сохраняем…')).toBeInTheDocument();
  });

  it('does not render close button for loading toast', () => {
    renderWithToastSpecs([{ message: 'Сохраняем…', kind: 'loading' }]);
    const toast = screen.getByTestId('toast-loading');
    expect(within(toast).queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument();
  });

  it('renders spinner for loading toast', () => {
    renderWithToastSpecs([{ message: 'Сохраняем…', kind: 'loading' }]);
    const toast = screen.getByTestId('toast-loading');
    const spinner = toast.querySelector('svg');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass('animate-spin');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ToastContainer countdown ring (#94)', () => {
  it('renders countdown ring and "Отменить" for toast with countdownMs', () => {
    renderWithToastSpecs([{ message: 'Событие удалено', kind: 'info' }], [() => {}], 5000);
    expect(screen.getByTestId('toast-countdown')).toBeInTheDocument();
    expect(screen.getByText('Отменить')).toBeInTheDocument();
    expect(screen.getByText('Событие удалено')).toBeInTheDocument();
  });

  it('does not render countdown ring for undo toast without countdownMs', () => {
    renderWithToastSpecs([{ message: 'Событие удалено', kind: 'info' }], [() => {}]);
    expect(screen.queryByTestId('toast-countdown')).not.toBeInTheDocument();
    expect(screen.getByText('Отменить')).toBeInTheDocument();
  });

  it('renders neither countdown ring nor "Отменить" for non-undo toast', () => {
    renderWithToastSpecs([{ message: 'Просто сообщение', kind: 'info' }]);
    expect(screen.queryByTestId('toast-countdown')).not.toBeInTheDocument();
    expect(screen.queryByText('Отменить')).not.toBeInTheDocument();
  });
});

// ── #285 D4 (rev8): generalized action slot on non-undo toasts ──────────────
describe('ToastContainer action slot (#285 D4 rev8)', () => {
  it('renders the action button with its custom label', () => {
    renderWithActionToast({ label: 'Обновить', onAction: () => {} });
    expect(screen.getByText('Обновить')).toBeInTheDocument();
    // No «Отменить» — the undo slot is not touched by the action slot.
    expect(screen.queryByText('Отменить')).not.toBeInTheDocument();
  });

  it('clicking the action button calls onAction and removes the toast', () => {
    const onAction = vi.fn();
    renderWithActionToast({ label: 'Обновить', onAction: onAction });
    fireEvent.click(screen.getByText('Обновить'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Не удалось удалить: данные изменились')).not.toBeInTheDocument();
  });

  it('undo toast rendering is untouched (action slot is additive)', () => {
    renderWithToasts(['Удалено'], [() => {}]);
    expect(screen.getByText('Отменить')).toBeInTheDocument();
  });
});

// ── #330 §5.3: persistent toast (connection-loss indicator) ────────────────
describe('ToastContainer persistent toast (#330)', () => {
  it('renders a persistent toast', () => {
    renderWithPersistentToast();
    expect(screen.getByText('Нет соединения с сервером. Обновления приостановлены.')).toBeInTheDocument();
  });

  it('does not render the close button for a persistent toast', () => {
    renderWithPersistentToast();
    const toast = screen.getByTestId('toast-error');
    expect(within(toast).queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument();
  });

  it('does not evict the persistent toast from a full 5-toast queue', () => {
    renderWithPersistentToast(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']);
    // the queue keeps its own last-5 slice
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.queryByText('Two')).not.toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.getByText('Seven')).toBeInTheDocument();
    // the persistent toast renders on top of the queue (5 + 1 max)
    expect(screen.getByText('Нет соединения с сервером. Обновления приостановлены.')).toBeInTheDocument();
  });
});
