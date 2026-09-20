import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { UIProvider, useUI } from '../contexts/UIContext';

// Test component that consumes the context
function UIConsumer() {
  const {
    deleteMode,
    toggleDeleteMode,
    toasts,
    showToast,
    hideToast,
    sidebarCollapsed,
    toggleSidebar,
    rightPanelCollapsed,
    toggleRightPanel,
    theme,
    toggleTheme,
  } = useUI();
  const shownIdRef = React.useRef('');

  return (
    <div>
      <span data-testid="last-shown-toast-id">{shownIdRef.current}</span>
      <span data-testid="delete-mode">{deleteMode.toString()}</span>
      <span data-testid="toast-count">{toasts.length}</span>
      <span data-testid="sidebar-collapsed">{sidebarCollapsed.toString()}</span>
      <span data-testid="right-panel-collapsed">
        {rightPanelCollapsed.toString()}
      </span>
      <span data-testid="theme">{theme}</span>
      <button data-testid="toggle-delete" onClick={toggleDeleteMode}>
        Toggle Delete
      </button>
      <button
        data-testid="show-toast"
        onClick={() => showToast('Test message')}
      >
        Show Toast
      </button>
      <button
        data-testid="show-toast-undo-countdown"
        onClick={() => showToast('Удалено', () => {}, 3000)}
      >
        Show Toast w/ Undo + Countdown
      </button>
      <button
        data-testid="show-toast-undo"
        onClick={() => showToast('Undoable', () => {})}
      >
        Show Toast w/ Undo
      </button>
      <button
        data-testid="show-toast-action"
        onClick={() =>
          showToast('Данные изменились', 'error', undefined, undefined, {
            label: 'Обновить',
            onAction: actionSpy,
          })
        }
      >
        Show Toast w/ Action
      </button>
      <button
        data-testid="show-toast-info-countdown"
        onClick={() => showToast('Info', 'info', undefined, 3000)}
      >
        Show Info Toast w/ Countdown Param
      </button>
      <button
        data-testid="hide-toast"
        onClick={() => hideToast(toasts[0]?.id ?? '')}
      >
        Hide Toast
      </button>
      <button data-testid="toggle-sidebar" onClick={toggleSidebar}>
        Toggle Sidebar
      </button>
      <button data-testid="toggle-right-panel" onClick={toggleRightPanel}>
        Toggle Right Panel
      </button>
      <button data-testid="toggle-theme" onClick={toggleTheme}>
        Toggle Theme
      </button>
      <button
        data-testid="show-loading-toast"
        onClick={() => {
          shownIdRef.current = showToast('Saving…', 'loading');
        }}
      >
        Show Loading Toast
      </button>
      <button
        data-testid="show-toast-persistent"
        onClick={() => {
          // #330: 6th positional param — persistent (no auto-dismiss timer).
          shownIdRef.current = showToast(
            'Нет соединения с сервером. Обновления приостановлены.',
            'error',
            undefined,
            undefined,
            undefined,
            true
          );
        }}
      >
        Show Persistent Toast
      </button>
      <button
        data-testid="hide-shown-toast"
        onClick={() => hideToast(shownIdRef.current)}
      >
        Hide Shown Toast
      </button>
    </div>
  );
}

function renderWithContext() {
  return render(
    <UIProvider>
      <UIConsumer />
    </UIProvider>
  );
}

const actionSpy = vi.fn();

describe('UIProvider', () => {
  beforeEach(() => {
    actionSpy.mockReset();
  });

  it('throws when useUI is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenConsumer() {
      useUI();
      return null;
    }
    expect(() => render(<BrokenConsumer />)).toThrow(
      'useUI must be used within UIProvider'
    );
    spy.mockRestore();
  });

  it('initializes deleteMode as false', () => {
    renderWithContext();
    expect(screen.getByTestId('delete-mode').textContent).toBe('false');
  });

  it('toggles deleteMode', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('toggle-delete').click();
    });
    expect(screen.getByTestId('delete-mode').textContent).toBe('true');
    act(() => {
      screen.getByTestId('toggle-delete').click();
    });
    expect(screen.getByTestId('delete-mode').textContent).toBe('false');
  });

  it('initializes sidebarCollapsed as false', () => {
    renderWithContext();
    expect(screen.getByTestId('sidebar-collapsed').textContent).toBe('false');
  });

  it('toggles sidebarCollapsed', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('toggle-sidebar').click();
    });
    expect(screen.getByTestId('sidebar-collapsed').textContent).toBe('true');
  });

  it('initializes rightPanelCollapsed as true', () => {
    renderWithContext();
    expect(screen.getByTestId('right-panel-collapsed').textContent).toBe(
      'true'
    );
  });

  it('toggles rightPanelCollapsed', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('toggle-right-panel').click();
    });
    expect(screen.getByTestId('right-panel-collapsed').textContent).toBe(
      'false'
    );
  });

  it('initializes with empty toasts', () => {
    renderWithContext();
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
  });

  it('shows a toast', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
  });

  it('shows a toast with undo callback', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast-undo').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
  });

  it('hides a toast', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      screen.getByTestId('hide-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
  });

  it('auto-removes toast after timeout', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });

  it('auto-removes an undo toast after its countdownMs window', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast-undo-countdown').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });

  it('auto-removes an undo toast without countdownMs after 5s', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast-undo').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });

  it('ignores countdownMs for non-undo toasts (still 4500ms)', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast-info-countdown').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(4499);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });

  it('auto-removes an action toast (no undo) after the 4500ms default (#285 rev8)', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast-action').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(4499);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });

  it('keeps a loading toast after 60s (no auto-hide)', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-loading-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    vi.useRealTimers();
  });

  it('hides a loading toast via hideToast', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-loading-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      screen.getByTestId('hide-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });

  // #330 §5.3: persistent toasts never get an auto-dismiss timer.
  it('keeps a persistent toast after 60s (no auto-hide) (#330)', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast-persistent').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    vi.useRealTimers();
  });

  it('hides a persistent toast via hideToast when the condition clears (#330)', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-toast-persistent').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    const shownId = screen.getByTestId('last-shown-toast-id').textContent;
    expect(shownId).toMatch(/^toast-\d+-/);
    act(() => {
      screen.getByTestId('hide-shown-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });

  it('showToast returns the id of the removed toast', () => {
    vi.useFakeTimers();
    renderWithContext();
    act(() => {
      screen.getByTestId('show-loading-toast').click();
    });
    expect(screen.getByTestId('toast-count').textContent).toBe('1');
    const shownId = screen.getByTestId('last-shown-toast-id').textContent;
    expect(shownId).toMatch(/^toast-\d+-/);
    act(() => {
      screen.getByTestId('hide-shown-toast').click();
    });
    // hiding by the returned id removed exactly the shown toast
    expect(screen.getByTestId('toast-count').textContent).toBe('0');
    vi.useRealTimers();
  });
});

describe('UIProvider theme persistence (#262 §5.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('reads theme from localStorage["memo-theme"] on mount', () => {
    localStorage.setItem('memo-theme', 'dark');
    renderWithContext();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('falls back to light when localStorage is empty', () => {
    renderWithContext();
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('applies data-theme attribute from localStorage on mount', () => {
    localStorage.setItem('memo-theme', 'dark');
    renderWithContext();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggleTheme writes localStorage and flips data-theme', () => {
    renderWithContext();
    expect(screen.getByTestId('theme').textContent).toBe('light');
    act(() => {
      screen.getByTestId('toggle-theme').click();
    });
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(localStorage.getItem('memo-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    act(() => {
      screen.getByTestId('toggle-theme').click();
    });
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(localStorage.getItem('memo-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
