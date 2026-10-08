import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PhoneInput, { getNationalDigits } from '@/app/components/shared/PhoneInput';
import RemoteSearchSelect from '@/app/components/shared/RemoteSearchSelect';

// GH #414 Task 4: record-form phone typeahead rebuilt on the country-selector
// engine (spec §Поиск и привязка клиента). RemoteSearchSelect keeps the
// typeahead role; `prefix` hosts the shared country selector (PhoneField's
// piece); formatting, the 4-NATIONAL-digit threshold and `?phone=` params key
// off the SELECTED country; onInputValueChange lifts the compact
// «+<код><национальные>» (replaces #221's visible-string WYSIWYG). Read-only
// after pick shows «Имя · телефон» (display formatter) with ×; the selector
// is inert there. The input-phone anchor stays on the remainder input.

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

function selectCountry(iso: string) {
  act(() => {
    fireEvent.click(screen.getByTestId('phone-country-select'));
  });
  act(() => {
    fireEvent.click(screen.getByTestId(`phone-country-select-option-${iso}`));
  });
}

function renderPhoneInput(overrides: Record<string, unknown> = {}) {
  return render(
    <PhoneInput onSearch={mockSearch} onPick={vi.fn()} {...overrides} />,
  );
}

describe('PhoneInput — country selector in the prefix (GH #414)', () => {
  it('renders «+7 Россия» in the prefix; input-phone anchors the remainder with the honest RU placeholder', () => {
    renderPhoneInput();
    const trigger = screen.getByTestId('phone-country-select');
    expect(trigger).toHaveTextContent('+7');
    expect(trigger).toHaveTextContent('Россия');

    const input = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(input).toHaveAttribute('placeholder', '999 123-45-67');
    expect(input).toHaveValue('');
  });

  it('opens the country listbox from the prefix, never the suggestion dropdown', () => {
    renderPhoneInput();
    act(() => {
      fireEvent.click(screen.getByTestId('phone-country-select'));
    });
    expect(screen.getByTestId('phone-country-select-popover')).toBeInTheDocument();
    // Only the country listbox exists — the typeahead never opened.
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    expect(screen.getAllByRole('option')).toHaveLength(9);
    expect(screen.getByTestId('phone-country-select-option-RU')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('switching the country mid-entry keeps the digits and regroups immediately (RU → LV)', () => {
    renderPhoneInput();
    typeValue('2312345');
    // RU min metadata does not group a 7-digit tail — digits as typed.
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('2312345');

    selectCountry('LV');
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Латвия');
    // Same digits, regrouped under the LV template on the spot.
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('23 123 45');
    expect(screen.getByTestId('input-phone')).toHaveAttribute('placeholder', '23 123 456');
  });

  it('switches the placeholder to the honest template of the chosen country', () => {
    renderPhoneInput();
    selectCountry('BY');
    expect(screen.getByTestId('input-phone')).toHaveAttribute('placeholder', '29 123 45 67');
  });
});

describe('PhoneInput — «+»-leading input parses as an international paste (GH #414)', () => {
  it('a list-country paste selects the country and keeps the national remainder', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('+375 29 123-45-67');
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Беларусь');
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('291234567');
    // The lift is already the BY compact — the parse binds before lifting.
    expect(onInputValueChange).toHaveBeenLastCalledWith('+375291234567');
  });

  it('an out-of-list paste («+1 …») enters «no country»: selector unchanged, raw digits, empty compact', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('+1 555 123-45-67');
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('15551234567');
    // No honest template while unbound; compact is undefined → lifted as ''.
    expect(screen.getByTestId('input-phone')).toHaveAttribute('placeholder', '');
    expect(onInputValueChange).toHaveBeenLastCalledWith('');
  });

  it('choosing a country exits «no country»: digits kept, template and compact follow', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('+1 555 123-45-67');
    selectCountry('DE');
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Германия');
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('15551234567');
    expect(screen.getByTestId('input-phone')).toHaveAttribute('placeholder', '1512 3456789');
    expect(onInputValueChange).toHaveBeenLastCalledWith('+4915551234567');
  });

  it('a typed «+» alone is ignored — the selector owns the country code', () => {
    renderPhoneInput();
    typeValue('+');
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('');
    typeValue('999+');
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('999');
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
  });
});

describe('PhoneInput — threshold and search digits from the SELECTED country (GH #221 invariant)', () => {
  it('does not fetch below 4 national digits', async () => {
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

  it('trunk 8 never leaks into the query — digits come from getNationalNumber', async () => {
    renderPhoneInput();
    typeValue('89991234');
    expect((screen.getByTestId('input-phone') as HTMLInputElement).value).toBe('8 (999) 123-4');
    await advanceDebounce();
    expect(mockSearch).toHaveBeenCalledWith({ phone: '9991234', per_page: 10 });
  });

  it('searches with the selected country’s national digits (BY)', async () => {
    renderPhoneInput();
    selectCountry('BY');
    typeValue('2912');
    await advanceDebounce();
    expect(mockSearch).toHaveBeenCalledWith({ phone: '2912', per_page: 10 });
  });

  it('does not fire while digits stay under the threshold', async () => {
    renderPhoneInput();
    typeValue('9');
    await advanceDebounce();
    typeValue('99');
    await advanceDebounce();
    typeValue('999');
    await advanceDebounce();
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe('PhoneInput — onInputValueChange lifts the compact (GH #414)', () => {
  it('lifts «+<код><национальные>» per keystroke', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('9991234');
    expect(onInputValueChange).toHaveBeenLastCalledWith('+79991234');
  });

  it('re-lifts the compact when the country changes mid-entry', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('9991234');
    expect(onInputValueChange).toHaveBeenLastCalledWith('+79991234');
    selectCountry('LV');
    expect(onInputValueChange).toHaveBeenLastCalledWith('+3719991234');
  });

  it('lifts «» when the field is emptied', () => {
    const onInputValueChange = vi.fn();
    renderPhoneInput({ onInputValueChange });
    typeValue('999');
    typeValue('');
    expect(onInputValueChange).toHaveBeenLastCalledWith('');
  });
});

// GH #414 fix round: the «no country with digits» state rides its own lift.
// The compact is '' there BY DESIGN (indistinguishable from an empty field),
// so the consumer's save-time block («Выберите страну из списка») needs the
// flag lifted alongside every compact lift.
describe('PhoneInput — no-country-with-digits lift (GH #414 fix)', () => {
  it('lifts blocked=true on an out-of-list paste with digits', () => {
    const onNoCountryDigits = vi.fn();
    renderPhoneInput({ onNoCountryDigits });
    typeValue('+1 650 555 1234');
    expect(onNoCountryDigits).toHaveBeenLastCalledWith(true);
  });

  it('lifts blocked=false when a list country is chosen (exit «без страны»)', () => {
    const onNoCountryDigits = vi.fn();
    renderPhoneInput({ onNoCountryDigits });
    typeValue('+1 555 123-45-67');
    selectCountry('DE');
    expect(onNoCountryDigits).toHaveBeenLastCalledWith(false);
  });

  it('lifts blocked=false when the digits are cleared (empty field is a legal save)', () => {
    const onNoCountryDigits = vi.fn();
    renderPhoneInput({ onNoCountryDigits });
    typeValue('+1 555 123-45-67');
    typeValue('');
    expect(onNoCountryDigits).toHaveBeenLastCalledWith(false);
  });

  it('never lifts true for plain RU typing', () => {
    const onNoCountryDigits = vi.fn();
    renderPhoneInput({ onNoCountryDigits });
    typeValue('9991234');
    expect(onNoCountryDigits).not.toHaveBeenCalledWith(true);
  });

  it('lifts blocked=false on a pick (no typed number remains)', async () => {
    const onNoCountryDigits = vi.fn();
    mockSearch.mockResolvedValue([
      { id: 'c1', name: 'Анна Иванова', phone: '+79991234567' },
    ]);
    renderPhoneInput({ onNoCountryDigits });
    typeValue('+1 555 123-45-67');
    typeValue('9991');
    await advanceDebounce();
    const rows = await screen.findAllByText('Анна Иванова · +7 999 123 45 67');
    const row = rows.find((el) => el.closest('li'));
    act(() => {
      fireEvent.click(row!);
    });
    expect(onNoCountryDigits).toHaveBeenLastCalledWith(false);
  });
});

describe('PhoneInput — read-only pick state (GH #221 × #414)', () => {
  it('suggestion rows show «Имя · телефон» via the display formatter; pick freezes the field and the selector; × restores', async () => {
    const onPick = vi.fn();
    mockSearch.mockResolvedValue([
      { id: 'c1', name: 'Анна Иванова', phone: '+79991234567' },
    ]);
    renderPhoneInput({ onPick });
    typeValue('9991');
    await advanceDebounce();

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова · +7 999 123 45 67')).toBeInTheDocument();
    });
    const rows = screen.getAllByText('Анна Иванова · +7 999 123 45 67');
    const row = rows.find((el) => el.closest('li'));
    act(() => {
      fireEvent.click(row!);
    });
    expect(onPick).toHaveBeenCalledWith({
      id: 'c1',
      name: 'Анна Иванова',
      phone: '+79991234567',
    });

    const input = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
    expect(input.value).toBe('Анна Иванова · +7 999 123 45 67');
    // The country selector is inert while frozen.
    expect(screen.getByTestId('phone-country-select')).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();

    // × → typing restored, selector live again.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    });
    const cleared = screen.getByTestId('input-phone') as HTMLInputElement;
    expect(cleared).not.toHaveAttribute('readonly');
    expect(cleared.value).toBe('');
    expect(screen.getByTestId('phone-country-select')).toBeEnabled();
  });

  it('renders «Без имени» for nameless suggestions', async () => {
    mockSearch.mockResolvedValue([
      { id: 'c1', name: null, phone: '+79991234567' },
    ]);
    renderPhoneInput();
    typeValue('9991');
    await advanceDebounce();
    await waitFor(() => {
      expect(screen.getByText('Без имени · +7 999 123 45 67')).toBeInTheDocument();
    });
  });

  it('lifts «» on pick (no typed number remains) and «» on × clear', async () => {
    const onInputValueChange = vi.fn();
    mockSearch.mockResolvedValue([
      { id: 'c1', name: 'Анна Иванова', phone: '+79991234567' },
    ]);
    renderPhoneInput({ onInputValueChange });
    typeValue('9991');
    await advanceDebounce();

    await waitFor(() => {
      expect(screen.getByText('Анна Иванова · +7 999 123 45 67')).toBeInTheDocument();
    });
    const rows = screen.getAllByText('Анна Иванова · +7 999 123 45 67');
    const row = rows.find((el) => el.closest('li'));
    act(() => {
      fireEvent.click(row!);
    });
    expect(onInputValueChange).toHaveBeenLastCalledWith('');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    });
    expect(onInputValueChange).toHaveBeenLastCalledWith('');
  });

  it('a consumer-controlled picked prop keeps the selector inert', () => {
    renderPhoneInput({
      picked: { id: 'c1', name: 'Анна', phone: '+79991234567' },
    });
    expect(screen.getByTestId('phone-country-select')).toBeDisabled();
  });
});

describe('getNationalDigits — digit source keyed by the selected country', () => {
  it('reduces via AsYouType(country).getNationalNumber()', () => {
    expect(getNationalDigits('9991234', 'RU')).toBe('9991234');
    // The typed trunk 8 is stripped — digits never scraped off the display.
    expect(getNationalDigits('8 (999) 123-4', 'RU')).toBe('9991234');
    expect(getNationalDigits('291234567', 'BY')).toBe('291234567');
  });

  it('«no country» falls back to the raw digits', () => {
    expect(getNationalDigits('15551234567', null)).toBe('15551234567');
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
