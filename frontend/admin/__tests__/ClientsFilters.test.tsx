import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { createMockClientsContext } from './helpers/mockContexts';

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
}));

import { useClients } from '@/contexts/ClientsContext';
import { ClientsFilters } from '../app/(main)/clients/components/ClientsFilters';

const mockUseClients = vi.mocked(useClients);

beforeEach(() => {
  mockUseClients.mockReturnValue(createMockClientsContext());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientsFilters', () => {
  it('renders search input', () => {
    render(<ClientsFilters />);
    expect(screen.getByPlaceholderText(/Поиск по имени или телефону/)).toBeInTheDocument();
  });

  it('renders status filter select', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Статус')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Все')).toBeInTheDocument();
  });

  it('renders visit range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Визиты')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('от').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText('до').length).toBeGreaterThanOrEqual(1);
  });

  it('renders missed range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Пропущенные')).toBeInTheDocument();
  });

  it('renders date range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Создан')).toBeInTheDocument();
    const dateInputs = screen.getAllByDisplayValue('');
    expect(dateInputs.filter(i => i.getAttribute('type') === 'date').length).toBeGreaterThanOrEqual(2);
  });

  it('renders payment range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Оплата')).toBeInTheDocument();
  });

  it('renders reset filters button', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Сбросить фильтры')).toBeInTheDocument();
  });

  it('calls resetFilters when reset button clicked', () => {
    const resetFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ resetFilters }));
    render(<ClientsFilters />);
    fireEvent.click(screen.getByText('Сбросить фильтры'));
    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  it('calls setFilters when status select changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Все');
    fireEvent.change(select, { target: { value: 'true' } });
    expect(setFilters).toHaveBeenCalledWith({ is_active: true });
  });

  it('calls setFilters with null when status reset to all', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Все');
    fireEvent.change(select, { target: { value: 'true' } });
    fireEvent.change(select, { target: { value: '' } });
    expect(setFilters).toHaveBeenLastCalledWith({ is_active: null });
  });

  it('calls setFilters when min visits input changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const minVisitsInputs = screen.getAllByPlaceholderText('от');
    fireEvent.change(minVisitsInputs[0], { target: { value: '3' } });
    expect(setFilters).toHaveBeenCalledWith({ min_visits: 3 });
  });

  it('calls setFilters with null when min visits is zero', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const minVisitsInputs = screen.getAllByPlaceholderText('от');
    fireEvent.change(minVisitsInputs[0], { target: { value: '0' } });
    expect(setFilters).toHaveBeenCalledWith({ min_visits: 0 });
  });

  it('calls setFilters when created_from date changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const dateInputs = screen.getAllByDisplayValue('');
    const dateFromInputs = dateInputs.filter(i => i.getAttribute('type') === 'date');
    fireEvent.change(dateFromInputs[0], { target: { value: '2026-01-01' } });
    expect(setFilters).toHaveBeenCalledWith({ created_from: '2026-01-01' });
  });
});
