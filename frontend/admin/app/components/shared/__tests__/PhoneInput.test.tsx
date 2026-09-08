import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PhoneInput from '@/app/components/shared/PhoneInput';
import RemoteSearchSelect from '@/app/components/shared/RemoteSearchSelect';

// GH #221 Task 5: adaptive-mask phone typeahead built on RemoteSearchSelect.
// Mask via libphonenumber-js AsYouType (min metadata), 4-DIGIT threshold,
// ?phone=<national digits>&per_page=10 requests, read-only state after pick.

const mockSearch = vi.fn();

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue([]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function typeValue(raw: string) {
  const input = screen.getByTestId('input-phone');
  act(() => {
    fireEvent.change(input, { target: { value: raw } });
  });
}

async function advanceDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

function renderPhoneInput(overrides: Record<string, unknown> = {}) {
  return render(
    <PhoneInput onSearch={mockSearch} onPick={vi.fn()} {...overrides} />,
  );
}

describe('PhoneInput', () => {
  // (a) adaptive mask: RU grouping for national digits, BY for +375
  it('formats RU digits progressively (9991234 → 999 123-4)', () => {
    renderPhoneInput();
    typeValue('9991234');
    const input = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(input.value).toBe('999 123-4');
  });

  it('switches to BY grouping when +375 is typed', () => {
    renderPhoneInput();
    typeValue('+375291234567');
    const input = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(input.value).toBe('+375 29 123 45 67');
  });

  // (b) 4-digit threshold: no request below, one debounced request at 4
  it('does not fetch below 4 digits', async () => {
    renderPhoneInput();
    typeValue('999');
    await advanceDebounce();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('fetches once with phone=<national digits> at the 4th digit', async () => {
    renderPhoneInput();
    typeValue('9991');
    await advanceDebounce();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith({ phone: '9991', per_page: 10 });
  });

  // (c) digits-source amendment: trunk 8 must not leak into the query
  it('sends national digits without the phantom 8 for 8-prefixed input', async () => {
    renderPhoneInput();
    typeValue('89991234');
    await advanceDebounce();
    expect(mockSearch).toHaveBeenCalledWith({ phone: '9991234', per_page: 10 });
  });

  it('sends national digits without the country code for +7 input', async () => {
    renderPhoneInput();
    typeValue('+79991234');
    await advanceDebounce();
    expect(mockSearch).toHaveBeenCalledWith({ phone: '9991234', per_page: 10 });
  });

  // (d) nameless clients render «Без имени»
  it('renders «Без имени» for nameless suggestions', async () => {
    mockSearch.mockResolvedValue([
      { id: 'c1', name: null, phone: '+79991234567' },
    ]);
    renderPhoneInput();
    typeValue('9991');
    await advanceDebounce();
    await waitFor(() => {
      expect(screen.getByText('Без имени · +79991234567')).toBeInTheDocument();
    });
  });

  // (e) pick → read-only + ×, clear → typing restored
  it('shows picked client read-only with clear button; clear restores typing', async () => {
    const onPick = vi.fn();
    mockSearch.mockResolvedValue([
      { id: 'c1', name: 'Анна Иванова', phone: '+79991234567' },
    ]);
    renderPhoneInput({ onPick });
    typeValue('9991');
    await advanceDebounce();

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова · +79991234567')).toBeInTheDocument();
    });
    const rows = screen.getAllByText('Анна Иванова · +79991234567');
    const row = rows.find((el) => el.closest('li'));
    fireEvent.click(row!);
    expect(onPick).toHaveBeenCalledWith({
      id: 'c1',
      name: 'Анна Иванова',
      phone: '+79991234567',
    });

    // read-only display + × affordance
    const input = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
    expect(input.value).toBe('Анна Иванова · +79991234567');
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();

    // clear → typing restored
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    const cleared = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(cleared).not.toHaveAttribute('readonly');
    expect(cleared.value).toBe('');
  });

  // (f) paste reformats on the next change; query digits are national
  it('reformats a pasted +7 999 123-45-67 and queries 9991234567', async () => {
    renderPhoneInput();
    typeValue('+7 999 123-45-67');
    const input = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(input.value).toBe('+7 999 123 45 67');
    await advanceDebounce();
    expect(mockSearch).toHaveBeenCalledWith({
      phone: '9991234567',
      per_page: 10,
    });
  });

  it('does not fire for digits shorter than the threshold while typing', async () => {
    renderPhoneInput();
    typeValue('9');
    await advanceDebounce();
    typeValue('99');
    await advanceDebounce();
    typeValue('999');
    await advanceDebounce();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  // (h) GH #221 Task 6: the consumer needs the visible formatted string for
  // the unpicked save payload (WYSIWYG) — PhoneInput lifts it per keystroke.
  it('lifts the formatted value via onInputValueChange', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('9991234');
    expect(onInputValueChange).toHaveBeenLastCalledWith('999 123-4');
  });

  it('lifts an empty string when the input is cleared', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('999');
    typeValue('');
    expect(onInputValueChange).toHaveBeenLastCalledWith('');
  });
});

// (g) T4 deferred nit: a consumer-supplied canSearch on RemoteSearchSelect
// itself must gate the dropdown open/fetch.
describe('RemoteSearchSelect custom canSearch (GH #221 T4 nit)', () => {
  it('gates the fetch when canSearch returns false and fires when true', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const canSearch = vi.fn((input: string) => input.endsWith('!'));

    render(
      <RemoteSearchSelect
        value={null}
        onChange={vi.fn()}
        onSearch={search}
        label="Тест"
        displayField="name"
        canSearch={canSearch}
      />,
    );
    const input = screen.getByRole('textbox');

    // canSearch → false: no fetch, no dropdown
    act(() => {
      fireEvent.change(input, { target: { value: 'нет' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(canSearch).toHaveBeenLastCalledWith('нет');
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // canSearch → true: fetch fires
    act(() => {
      fireEvent.change(input, { target: { value: 'да!' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(canSearch).toHaveBeenLastCalledWith('да!');
    await waitFor(() => {
      expect(search).toHaveBeenCalledWith('да!');
    });
  });
});
