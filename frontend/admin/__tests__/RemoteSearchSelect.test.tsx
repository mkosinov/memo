import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RemoteSearchSelect from '@/app/components/shared/RemoteSearchSelect';

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
  onChange: vi.fn(),
  onSearch: mockSearch,
  label: 'Посетитель',
  placeholder: 'Введите имя...',
  displayField: 'name',
};

function renderRemoteSearchSelect(overrides: Record<string, unknown> = {}) {
  return render(<RemoteSearchSelect {...defaultProps} {...overrides} />);
}

describe('RemoteSearchSelect', () => {
  it('renders label and input', () => {
    renderRemoteSearchSelect();
    expect(screen.getByLabelText(/Посетитель/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows placeholder text', () => {
    renderRemoteSearchSelect({ placeholder: 'Поиск...' });
    expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
  });

  it('shows required indicator when required prop is true', () => {
    renderRemoteSearchSelect({ required: true });
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('does not call onSearch for queries shorter than 2 characters', async () => {
    mockSearch.mockResolvedValue([]);

    renderRemoteSearchSelect();
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

    renderRemoteSearchSelect();
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

    renderRemoteSearchSelect();
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

    renderRemoteSearchSelect({ onChange });
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

    renderRemoteSearchSelect();
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

    renderRemoteSearchSelect({ onChange });
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

    renderRemoteSearchSelect();
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

    renderRemoteSearchSelect({ subtitleField: 'price' });
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
        <RemoteSearchSelect {...defaultProps} />
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
    renderRemoteSearchSelect();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  // GH #221 Task 4: parameterize the threshold + query building so consumers
  // (e.g. the phone typeahead) can pick a different min-char count and
  // request-param shape without forking the component.
  it('fires below 2 chars when minChars is lowered', async () => {
    mockSearch.mockResolvedValue([]);

    renderRemoteSearchSelect({ minChars: 1 });
    const input = screen.getByRole('textbox');

    // 1 char — above the lowered minChars=1 threshold
    act(() => {
      fireEvent.change(input, { target: { value: 'А' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('А');
    });
  });

  it('blocks search below a raised minChars threshold and fires once crossed', async () => {
    mockSearch.mockResolvedValue([]);

    renderRemoteSearchSelect({ minChars: 4 });
    const input = screen.getByRole('textbox');

    // 3 chars — below minChars=4: no search
    act(() => {
      fireEvent.change(input, { target: { value: 'Анн' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockSearch).not.toHaveBeenCalled();

    // 4th char — crosses the threshold: search fires
    act(() => {
      fireEvent.change(input, { target: { value: 'Анна' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('Анна');
    });
  });

  // GH #368: the select is honestly uncontrolled — `value` is gone from the
  // contract and `onChange` is optional (tag pickers react via onSelectItem).
  // Picking / clearing must not crash when no onChange is provided.
  it('selects an item without crashing when onChange is not provided', async () => {
    mockSearch.mockResolvedValue([{ id: 'v1', name: 'Анна Иванова' }]);

    render(
      <RemoteSearchSelect
        onSearch={mockSearch}
        label="Клиент"
        displayField="name"
      />,
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

    const dropdownItem = screen
      .getAllByText('Анна Иванова')
      .find((el) => el.tagName === 'LI' || el.closest('li'));
    fireEvent.click(dropdownItem!);

    expect(screen.getByDisplayValue('Анна Иванова')).toBeInTheDocument();
  });

  it('clears a selection without crashing when onChange is not provided', async () => {
    mockSearch.mockResolvedValue([{ id: 'v1', name: 'Анна Иванова' }]);

    render(
      <RemoteSearchSelect
        onSearch={mockSearch}
        label="Клиент"
        displayField="name"
      />,
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

    const dropdownItem = screen
      .getAllByText('Анна Иванова')
      .find((el) => el.tagName === 'LI' || el.closest('li'));
    fireEvent.click(dropdownItem!);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(screen.getByDisplayValue('')).toBeInTheDocument();
  });

  it('builds request params via buildParams and passes them to onSearch', async () => {
    mockSearch.mockResolvedValue([{ id: 'c1', name: 'Анна' }]);
    const buildParams = vi.fn((input: string) => ({ phone: input }));

    renderRemoteSearchSelect({ buildParams });
    const input = screen.getByRole('textbox');

    act(() => {
      fireEvent.change(input, { target: { value: '7996' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(buildParams).toHaveBeenCalledWith('7996');
    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith({ phone: '7996' });
    });
  });

  // GH #414 Task 3: optional `prefix` slot — an adornment rendered inside the
  // field frame before the input (e.g. the phone country selector). Without
  // the prop the markup and behavior must stay exactly as before; with it,
  // clicks on the prefix never open the suggestions dropdown (stop click).
  it('without prefix the input itself remains the framed element (layout unchanged)', () => {
    renderRemoteSearchSelect();
    const input = screen.getByRole('textbox');

    // The input still carries the frame itself: border + padding + width.
    expect(input).toHaveClass('w-full', 'rounded-lg', 'border', 'px-3', 'py-2');
    // No adornment wrappers were added into the field row.
    expect(input.parentElement!.childElementCount).toBe(1);
  });

  it('renders the prefix inside the field frame, before the input', () => {
    renderRemoteSearchSelect({
      prefix: <span data-testid="field-prefix">+7</span>,
    });
    const input = screen.getByRole('textbox');
    const marker = screen.getByTestId('field-prefix');

    // The prefix lives in the same frame as the input…
    const frame = input.parentElement!;
    expect(frame).toContainElement(marker);
    // …and precedes the input in DOM order.
    expect(
      marker.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The input no longer draws its own border — the frame does.
    expect(input).not.toHaveClass('border');
  });

  it('clicking the prefix does not open the dropdown and stops the click', async () => {
    mockSearch.mockResolvedValue([{ id: 'v1', name: 'Анна Иванова' }]);
    const onRootClick = vi.fn();

    render(
      <div onClick={onRootClick}>
        <RemoteSearchSelect
          {...defaultProps}
          prefix={<span data-testid="field-prefix">+7</span>}
        />
        <div data-testid="outside">Outside</div>
      </div>,
    );
    const input = screen.getByRole('textbox');

    // Cache results and open the dropdown.
    act(() => {
      fireEvent.change(input, { target: { value: 'Ан' } });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => {
      expect(screen.getByText('Анна Иванова')).toBeInTheDocument();
    });

    // Close via outside click — results stay cached in state.
    fireEvent.mouseDown(screen.getByTestId('outside'));
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    // Click the prefix: the dropdown must not reopen…
    fireEvent.click(screen.getByTestId('field-prefix'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // …and the click must not escape the prefix slot.
    expect(onRootClick).not.toHaveBeenCalled();

    // Control: in the same state, focusing the input DOES reopen the
    // dropdown, so the prefix assertion above is not vacuous.
    fireEvent.focus(input);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });
});
