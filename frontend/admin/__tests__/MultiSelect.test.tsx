import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MultiSelect } from '../app/components/shared/MultiSelect';

type TestItem = { id: string; name: string; group: string };

const groupedItems: TestItem[] = [
  { id: 'm1', name: 'Ольга', group: 'Живопись' },
  { id: 'm2', name: 'Юлия', group: 'Живопись' },
  { id: 'm3', name: 'Анна', group: 'Керамика' },
];

const flatItems: TestItem[] = [
  { id: 'loc1', name: 'Альпика', group: '' },
  { id: 'loc2', name: 'Гранд', group: '' },
  { id: 'loc3', name: 'Поляна', group: '' },
];

function renderGrouped(selectedIds: string[] = []) {
  const onSelectionChange = vi.fn();
  render(
    <MultiSelect<TestItem>
      items={groupedItems}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      label="Мастера"
      getId={(item) => item.id}
      getLabel={(item) => item.name}
      getGroup={(item) => item.group}
    />,
  );
  return { onSelectionChange };
}

function renderFlat(selectedIds: string[] = []) {
  const onSelectionChange = vi.fn();
  render(
    <MultiSelect<TestItem>
      items={flatItems}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      label="Локации"
      getId={(item) => item.id}
      getLabel={(item) => item.name}
    />,
  );
  return { onSelectionChange };
}

function openDropdown() {
  fireEvent.click(screen.getByRole('button', { name: /Мастера|Локации/ }));
}

describe('MultiSelect', () => {
  describe('grouped mode (getGroup provided)', () => {
    it('does NOT render "Выбрать все" / "Снять все" buttons', () => {
      renderGrouped();
      openDropdown();
      expect(screen.queryByText('Выбрать все')).not.toBeInTheDocument();
      expect(screen.queryByText('Снять все')).not.toBeInTheDocument();
    });

    it('renders group headers with checkboxes', () => {
      renderGrouped();
      openDropdown();
      expect(screen.getByText('Живопись')).toBeInTheDocument();
      expect(screen.getByText('Керамика')).toBeInTheDocument();
      // Each group should have a checkbox
      const groupCheckboxes = screen.getAllByTestId(/^group-checkbox-/);
      expect(groupCheckboxes.length).toBe(2);
    });

    it('shows group checkbox unchecked when no items in group are selected', () => {
      renderGrouped([]);
      openDropdown();
      const groupCheckbox = screen.getByTestId('group-checkbox-Живопись');
      expect(groupCheckbox).not.toBeChecked();
    });

    it('shows group checkbox checked when ALL items in group are selected', () => {
      renderGrouped(['m1', 'm2']); // Both Живопись items
      openDropdown();
      const groupCheckbox = screen.getByTestId('group-checkbox-Живопись');
      expect(groupCheckbox).toBeChecked();
    });

    it('shows group checkbox indeterminate when SOME items in group are selected', () => {
      renderGrouped(['m1']); // Only one of two Живопись items
      openDropdown();
      const groupCheckbox = screen.getByTestId('group-checkbox-Живопись') as HTMLInputElement;
      // indeterminate is not reflected in checked attribute but via JS property
      expect(groupCheckbox.indeterminate).toBe(true);
      expect(groupCheckbox.checked).toBe(false);
    });

    it('clicking unchecked group checkbox selects all items in that group', () => {
      const { onSelectionChange } = renderGrouped([]);
      openDropdown();
      fireEvent.click(screen.getByTestId('group-checkbox-Живопись'));
      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.arrayContaining(['m1', 'm2']),
      );
    });

    it('clicking checked group checkbox deselects all items in that group', () => {
      const { onSelectionChange } = renderGrouped(['m1', 'm2']);
      openDropdown();
      fireEvent.click(screen.getByTestId('group-checkbox-Живопись'));
      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.not.arrayContaining(['m1', 'm2']),
      );
    });

    it('clicking group checkbox preserves selections from other groups', () => {
      const { onSelectionChange } = renderGrouped(['m3']);
      openDropdown();
      fireEvent.click(screen.getByTestId('group-checkbox-Живопись'));
      const calledWith = onSelectionChange.mock.calls[0][0] as string[];
      expect(calledWith).toContain('m3'); // Керамика selection preserved
      expect(calledWith).toContain('m1'); // Живопись now selected
      expect(calledWith).toContain('m2'); // Живопись now selected
    });

    it('individual item toggle still works', () => {
      const { onSelectionChange } = renderGrouped([]);
      openDropdown();
      fireEvent.click(screen.getByTestId('multiselect-option-m1'));
      expect(onSelectionChange).toHaveBeenCalledWith(['m1']);
    });
  });

  describe('flat mode (no getGroup)', () => {
    it('does NOT render "Снять все" button (only checkbox-style select-all)', () => {
      renderFlat();
      openDropdown();
      // "Снять все" should never appear
      expect(screen.queryByText('Снять все')).not.toBeInTheDocument();
    });

    it('renders a "Выбрать все" checkbox at the top', () => {
      renderFlat();
      openDropdown();
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument();
    });

    it('shows select-all checkbox unchecked when nothing is selected', () => {
      renderFlat([]);
      openDropdown();
      expect(screen.getByTestId('select-all-checkbox')).not.toBeChecked();
    });

    it('shows select-all checkbox checked when all items are selected', () => {
      renderFlat(['loc1', 'loc2', 'loc3']);
      openDropdown();
      expect(screen.getByTestId('select-all-checkbox')).toBeChecked();
    });

    it('shows select-all checkbox indeterminate when some items are selected', () => {
      renderFlat(['loc1']);
      openDropdown();
      const checkbox = screen.getByTestId('select-all-checkbox') as HTMLInputElement;
      expect(checkbox.indeterminate).toBe(true);
      expect(checkbox.checked).toBe(false);
    });

    it('clicking unchecked select-all checkbox selects all items', () => {
      const { onSelectionChange } = renderFlat([]);
      openDropdown();
      fireEvent.click(screen.getByTestId('select-all-checkbox'));
      expect(onSelectionChange).toHaveBeenCalledWith(['loc1', 'loc2', 'loc3']);
    });

    it('clicking checked select-all checkbox deselects all items', () => {
      const { onSelectionChange } = renderFlat(['loc1', 'loc2', 'loc3']);
      openDropdown();
      fireEvent.click(screen.getByTestId('select-all-checkbox'));
      expect(onSelectionChange).toHaveBeenCalledWith([]);
    });

    it('individual item toggle still works in flat mode', () => {
      const { onSelectionChange } = renderFlat([]);
      openDropdown();
      fireEvent.click(screen.getByTestId('multiselect-option-loc1'));
      expect(onSelectionChange).toHaveBeenCalledWith(['loc1']);
    });
  });

  describe('empty items', () => {
    it('shows "Нет элементов" when items list is empty', () => {
      const onSelectionChange = vi.fn();
      render(
        <MultiSelect<TestItem>
          items={[]}
          selectedIds={[]}
          onSelectionChange={onSelectionChange}
          label="Пусто"
          getId={(item) => item.id}
          getLabel={(item) => item.name}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Пусто' }));
      expect(screen.getByText('Нет элементов')).toBeInTheDocument();
    });
  });

  describe('trigger display', () => {
    it('shows count of selected items in trigger', () => {
      renderGrouped(['m1', 'm2']);
      expect(screen.getByText(/Мастера \(2\/3\)/)).toBeInTheDocument();
    });

    it('shows 0 selected when none selected', () => {
      renderGrouped([]);
      expect(screen.getByText(/Мастера \(0\/3\)/)).toBeInTheDocument();
    });
  });
});
