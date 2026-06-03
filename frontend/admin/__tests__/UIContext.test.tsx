import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  } = useUI();

  return (
    <div>
      <span data-testid="delete-mode">{deleteMode.toString()}</span>
      <span data-testid="toast-count">{toasts.length}</span>
      <span data-testid="sidebar-collapsed">{sidebarCollapsed.toString()}</span>
      <span data-testid="right-panel-collapsed">
        {rightPanelCollapsed.toString()}
      </span>
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
        data-testid="show-toast-undo"
        onClick={() => showToast('Undoable', () => {})}
      >
        Show Toast w/ Undo
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

describe('UIProvider', () => {
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
});
