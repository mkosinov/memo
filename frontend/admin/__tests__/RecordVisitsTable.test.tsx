/**
 * Tests for RecordVisitsTable — preserve submitted values after save.
 *
 * Verifies that after saving a new visit, the row shows the SUBMITTED name
 * (not blank from stale visitorsMap).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { RecordVisitsTable } from '../app/components/shared/record/blocks/RecordVisitsTable';
import type { VisitResponse, TariffResponse } from '@memo/api-client';

// ─── Mock data ───────────────────────────────────────────────────────────────

const mockTariffs: TariffResponse[] = [
  { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
  { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
];

const mockVisits: VisitResponse[] = [];

// Empty visitorsMap — simulates stale cache (new visitor not yet loaded)
const emptyVisitorsMap = new Map<string, { name: string; age: number | null }>();

// ─── Helper ──────────────────────────────────────────────────────────────────

function renderVisitsTable(opts: {
  visits?: VisitResponse[];
  visitorsMap?: Map<string, { name: string; age: number | null }>;
  onAddVisit?: (data: any) => Promise<VisitResponse>;
} = {}) {
  const onAddVisit = opts.onAddVisit ?? vi.fn().mockResolvedValue({
    id: 'v_new',
    record_id: 'r1',
    visitor_id: 'vis_new',
    tariff_id: 't1',
    price: 3500,
    custom_price: null,
    status: 'waiting',
    created_at: '',
    updated_at: '',
  } as VisitResponse);

  const onPatchVisit = vi.fn();
  const onDeleteVisit = vi.fn().mockResolvedValue(undefined);
  const onChangeVisitor = vi.fn();
  const onAnonymVisitsChange = vi.fn();

  render(
    <RecordVisitsTable
      visits={opts.visits ?? mockVisits}
      visitorsMap={opts.visitorsMap ?? emptyVisitorsMap}
      tariffs={mockTariffs}
      anonymVisits={0}
      totalCost={0}
      recordStatus="waiting"
      clientId="c1"
      onAddVisit={onAddVisit}
      onPatchVisit={onPatchVisit}
      onDeleteVisit={onDeleteVisit}
      onChangeVisitor={onChangeVisitor}
      onAnonymVisitsChange={onAnonymVisitsChange}
    />,
  );

  return { onAddVisit, onPatchVisit, onDeleteVisit, onChangeVisitor };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RecordVisitsTable — new-row save + preserve values', () => {
  it('saves anonymous visit (blank name) on Enter', async () => {
    const { onAddVisit } = renderVisitsTable();

    // Click "+ Добавить" to add a new row
    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    expect(screen.getByTestId('visit-row-new')).toBeInTheDocument();

    // Don't type anything — just press Enter in the name input
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => expect(onAddVisit).toHaveBeenCalledTimes(1));
    // Should be called with empty name (anonymous visit)
    expect(onAddVisit).toHaveBeenCalledWith(
      expect.objectContaining({ name: '' }),
    );
  });

  it('after save, row shows the SUBMITTED name (not blank from stale visitorsMap)', async () => {
    // The API returns a VisitResponse WITHOUT name (only visitor_id).
    // The visitorsMap is EMPTY (stale — new visitor not yet loaded).
    // The row should still show "Анна" (the submitted name).
    const { onAddVisit } = renderVisitsTable();

    fireEvent.click(screen.getByTestId('btn-add-visitor'));
    const nameInput = screen.getByTestId('add-visitor-name');

    // Type a name
    fireEvent.change(nameInput, { target: { value: 'Анна' } });

    // Press Enter to save
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => expect(onAddVisit).toHaveBeenCalledTimes(1));

    // After save, the row should display "Анна" — NOT blank / "Аноним"
    await waitFor(() => {
      // The row should now have a real id (not "new")
      const savedRow = screen.getByTestId('visit-row-v_new');
      expect(savedRow).toBeInTheDocument();
    });

    // The name input should show "Анна" (preserved from submitted values)
    // After save, the row remounts with the saved data. The name should be visible.
    const savedRow = screen.getByTestId('visit-row-v_new');
    // Find the name input (not the age select)
    const savedNameInput = savedRow.querySelector('input[type="text"]') as HTMLInputElement;
    expect(savedNameInput).toBeTruthy();
    expect(savedNameInput.value).toBe('Анна');
  });

  it('saves visit with only tariff selected (no name, no age)', async () => {
    const { onAddVisit } = renderVisitsTable();

    fireEvent.click(screen.getByTestId('btn-add-visitor'));

    // Select a tariff (but don't type a name)
    const tariffSelect = screen.getByTestId('add-visitor-tariff');
    fireEvent.change(tariffSelect, { target: { value: 't2' } });

    // Press Enter to save
    const nameInput = screen.getByTestId('add-visitor-name');
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => expect(onAddVisit).toHaveBeenCalledTimes(1));
    expect(onAddVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '',
        tariff_id: 't2',
        price: 2500,
      }),
    );
  });
});
