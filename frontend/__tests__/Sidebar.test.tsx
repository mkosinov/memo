import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Sidebar } from '../app/components/layout/Sidebar';
import { ScheduleProvider } from '../contexts/ScheduleContext';
import { UIProvider } from '../contexts/UIContext';
import { getMonday } from '../lib/utils';

function renderWithProviders() {
  return render(
    <UIProvider>
      <ScheduleProvider>
        <Sidebar />
      </ScheduleProvider>
    </UIProvider>
  );
}

describe('Sidebar', () => {
  it('renders the logo text "Colour Mountains"', () => {
    renderWithProviders();
    expect(screen.getByText(/Colour Mountains/i)).toBeInTheDocument();
  });

  it('renders navigation links in Russian', () => {
    renderWithProviders();
    expect(screen.getByRole('button', { name: 'Расписание' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Бронирования' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Клиенты' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Мастера' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Чат' })).toBeInTheDocument();
  });

  it('highlights the active navigation link (Расписание)', () => {
    renderWithProviders();
    const activeLink = screen.getByRole('button', { name: 'Расписание' });
    expect(activeLink).toHaveClass('bg-brand');
  });

  it('renders artist legend with color dots', () => {
    renderWithProviders();
    expect(screen.getByText('Ольга')).toBeInTheDocument();
    expect(screen.getByText('Юлия')).toBeInTheDocument();
    expect(screen.getByText('Анастасия')).toBeInTheDocument();
  });

  it('renders theme toggle button', () => {
    renderWithProviders();
    const toggle = screen.getByRole('button', { name: /Переключить/i });
    expect(toggle).toBeInTheDocument();
  });

  it('renders collapse/expand button', () => {
    renderWithProviders();
    const collapseBtn = screen.getByRole('button', { name: /Свернуть|Развернуть/i });
    expect(collapseBtn).toBeInTheDocument();
  });

  it('renders version number at bottom', () => {
    renderWithProviders();
    expect(screen.getByText(/v0\.1/i)).toBeInTheDocument();
  });

  it('renders mini calendar with current month name', () => {
    renderWithProviders();
    const now = new Date();
    const monthNames = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
    ];
    const currentMonth = monthNames[now.getMonth()];
    // The month text is rendered alongside the year, so use a regex
    expect(screen.getByText(new RegExp(currentMonth))).toBeInTheDocument();
  });

  it('renders day headers in the mini calendar', () => {
    renderWithProviders();
    expect(screen.getByText('ПН')).toBeInTheDocument();
    expect(screen.getByText('ВС')).toBeInTheDocument();
  });

  it('collapses sidebar when collapse button is clicked', () => {
    renderWithProviders();
    const sidebar = screen.getByTestId('sidebar');
    // Initially not collapsed (width is 230px)
    expect(sidebar).toHaveStyle({ width: 'var(--sidebar-w)' });

    // Find and click collapse button
    const collapseBtn = screen.getByRole('button', { name: /Свернуть/i });
    fireEvent.click(collapseBtn);

    // After click, sidebar should be collapsed (width is 56px)
    expect(sidebar).toHaveStyle({ width: 'var(--sidebar-collapsed-w)' });
  });

  it('toggles theme when theme button is clicked', () => {
    renderWithProviders();
    const toggle = screen.getByRole('button', { name: /Переключить/i });
    const html = document.documentElement;
    const initialTheme = html.getAttribute('data-theme');
    fireEvent.click(toggle);
    const newTheme = html.getAttribute('data-theme');
    expect(newTheme).toBe('dark');
  });
});
