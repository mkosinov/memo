import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { RightPanel } from '../app/components/layout/RightPanel';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider, useUI } from '../contexts/UIContext';

function renderWithProviders() {
  return render(
    <UIProvider>
      <ScheduleProvider>
        <RightPanel />
      </ScheduleProvider>
    </UIProvider>
  );
}

describe('RightPanel', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders "Штамп" section title', () => {
    renderWithProviders();
    expect(screen.getByText('Штамп')).toBeInTheDocument();
  });

  it('renders "Неделя" section title', () => {
    renderWithProviders();
    expect(screen.getByText('Неделя')).toBeInTheDocument();
  });

  it('sections are collapsible — clicking header toggles content visibility', () => {
    renderWithProviders();

    // Find the Штамп section header button
    const stampHeader = screen.getByRole('button', { name: /Штамп/i });
    expect(stampHeader).toBeInTheDocument();

    // Content should be visible initially (has max-h-96)
    const stampContent = screen.getByTestId('stamp-content');
    expect(stampContent).toHaveClass('max-h-96');

    // Click to collapse
    fireEvent.click(stampHeader);
    expect(stampContent).toHaveClass('max-h-0');

    // Click to expand again
    fireEvent.click(stampHeader);
    expect(stampContent).toHaveClass('max-h-96');
  });

  it('renders with default width', () => {
    const { container } = render(
      <UIProvider>
        <ScheduleProvider>
          <RightPanel />
        </ScheduleProvider>
      </UIProvider>
    );

    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveStyle({ width: 'var(--right-w)' });
  });

  it('panel is hidden when rightPanelCollapsed is true', () => {
    function TestHarness() {
      const { toggleRightPanel } = useUI();
      React.useEffect(() => { toggleRightPanel(); }, []);
      return <RightPanel />;
    }

    const { container } = render(
      <UIProvider>
        <ScheduleProvider>
          <TestHarness />
        </ScheduleProvider>
      </UIProvider>,
    );

    // When collapsed, the panel renders a floating tab instead of the full panel
    const panel = container.querySelector('[data-testid="right-panel"]');
    expect(panel).not.toBeInTheDocument();
    // But the floating tab should be present
    expect(screen.getByRole('button', { name: /Развернуть/i })).toBeInTheDocument();
  });

  it('renders toggle button in header', () => {
    renderWithProviders();
    const toggleBtn = screen.getByRole('button', { name: /Свернуть|Развернуть/i });
    expect(toggleBtn).toBeInTheDocument();
  });

  it('shows floating tab when collapsed', () => {
    function TestHarness() {
      const { toggleRightPanel } = useUI();
      React.useEffect(() => { toggleRightPanel(); }, []);
      return <RightPanel />;
    }

    render(
      <UIProvider>
        <ScheduleProvider>
          <TestHarness />
        </ScheduleProvider>
      </UIProvider>,
    );

    const floatingTab = screen.getByRole('button', { name: /Развернуть/i });
    expect(floatingTab).toBeInTheDocument();
  });

  it('renders copy last week button in Неделя section', () => {
    renderWithProviders();
    const copyBtn = screen.getByRole('button', { name: /Копировать прошлую/i });
    expect(copyBtn).toBeInTheDocument();
  });
});
