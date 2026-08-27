import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SearchableSelect from '@/app/components/shared/SearchableSelect';

// Mock search function
const mockSearch = vi.fn();

beforeEach(() => {
  mockSearch.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const defaultProps = {
  value: null as string | null,
  onChange: vi.fn(),
  onSearch: mockSearch,
  label: 'Посетитель',
  placeholder: 'Введите имя...',
  displayField: 'name',
};

function renderSearchableSelect(overrides: Record<string, unknown> = {}) {
  return render(<SearchableSelect {...defaultProps} {...overrides} />);
}

describe('SearchableSelect', () => {
  it('renders label and input', () => {
    renderSearchableSelect();
    expect(screen.getByLabelText(/Посетитель/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows placeholder text', () => {
    renderSearchableSelect({ placeholder: 'Поиск...' });
    expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
  });

  it('shows required indicator when required prop is true', () => {
    renderSearchableSelect({ required: true });
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not call onSearch for queries shorter than 2 characters', async () => {
    mockSearch.mockResolvedValue([]);

    renderSearchableSelect();
    const input = screen.getByRole('textbox');

    // Type a single character
    act(() => {
      fireEvent.change(input, { target: { value: 'А' } });
    });

    // Advance past debounce (300ms)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // 1 char — below the ≥2 threshold: no search call
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('calls onSearch on input change (debounced)', async () => {
    mockSearch.mockResolvedValue([]);

    renderSearchableSelect();
    const input = screen.getByRole('textbox');

    // Type two characters (≥2 threshold)
    act(() => {
      fireEvent.change(input, { target: { value: 'Ан' } });
    });

    // Before debounce fires — no search yet
    expect(mockSearch).not.toHaveBeenCalled();

    // Advance past debounce (300ms)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('Ан');
    });
  });

  it('shows results in dropdown after search', async () => {
    mockSearch.mockResolvedValue([
      { id: 'v1', name: 'Анна Иванова' },
      { id: 'v2', name: 'Алексей Петров' },
    ]);

    renderSearchableSelect();
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.change(input, { target: { value: 'Ан' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
      expect(screen.getByText('Алексей Петров')).toBeInTheDocument();
    });
  });

  it('calls onChange with selected item id', async () => {
    const onChange = vi.fn();
    mockSearch.mockResolvedValue([
      { id: 'v1', name: 'Анна Иванова' },
      { id: 'v2', name: 'Алексей Петров' },
    ]);

    renderSearchableSelect({ onChange });
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.change(input, { target: { value: 'Ан' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    });

    // Find the dropdown item (li element) and click it
    const dropdownItems = screen.getAllByText('Анна Иванова');
    const dropdownItem = dropdownItems.find(
      (el) => el.tagName === 'LI' || el.closest('li'),
    );
    fireEvent.click(dropdownItem!);
    expect(onChange).toHaveBeenCalledWith('v1');
  });

  it('shows selected value after selection', async () => {
    mockSearch.mockResolvedValue([{ id: 'v1', name: 'Анна Иванова' }]);

    renderSearchableSelect();
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.change(input, { target: { value: 'Ан' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    });

    // Click the dropdown item (li)
    const dropdownItems = screen.getAllByText('Анна Иванова');
    const dropdownItem = dropdownItems.find(
      (el) => el.tagName === 'LI' || el.closest('li'),
    );
    fireEvent.click(dropdownItem!);

    // After selection, input should show the selected label
    expect(screen.getByDisplayValue('Анна Иванова')).toBeInTheDocument();
  });

  it('clear button resets value', async () => {
    const onChange = vi.fn();
    mockSearch.mockResolvedValue([{ id: 'v1', name: 'Анна Иванова' }]);

    renderSearchableSelect({ onChange });
    const input = screen.getByRole('textbox');

    // Select an item
    act(() => {
      fireEvent.change(input, { target: { value: 'Ан' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    });

    const dropdownItems = screen.getAllByText('Анна Иванова');
    const dropdownItem = dropdownItems.find(
      (el) => el.tagName === 'LI' || el.closest('li'),
    );
    fireEvent.click(dropdownItem!);
    expect(onChange).toHaveBeenCalledWith('v1');

    // Now clear
    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows "Ничего не найдено" for empty results', async () => {
    mockSearch.mockResolvedValue([]);

    renderSearchableSelect();
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.change(input, { target: { value: 'Несуществующий' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
    });
  });

  it('shows subtitle when subtitleField is provided', async () => {
    mockSearch.mockResolvedValue([
      { id: 's1', name: 'Картина маслом', price: '3500' },
    ]);

    renderSearchableSelect({ subtitleField: 'price' });
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.change(input, { target: { value: 'Ка' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText(/Картина маслом/)).toBeInTheDocument();
      expect(screen.getByText(/3500/)).toBeInTheDocument();
    });
  });

  it('closes dropdown on outside click', async () => {
    mockSearch.mockResolvedValue([{ id: 'v1', name: 'Анна Иванова' }]);

    render(
      <div>
        <SearchableSelect {...defaultProps} />
        <div data-testid="outside">Outside</div>
      </div>,
    );
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.change(input, { target: { value: 'Ан' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() => {
      expect(screen.queryByText('Анна Иванова')).not.toBeInTheDocument();
    });
  });

  it('does not show dropdown when query is empty', () => {
    renderSearchableSelect();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
