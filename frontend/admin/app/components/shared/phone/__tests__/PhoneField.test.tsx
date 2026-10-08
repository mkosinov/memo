import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  PhoneField,
  phoneVisible,
  phoneCompact,
  phoneIsComplete,
  type PhoneFieldValue,
} from '@/app/components/shared/phone/PhoneField';

// GH #414 Task 2: PhoneField — composite field `[«+7 Россия ⌄»] │ [remainder] [×]`
// (spec §Виджет PhoneField). Controlled value { country, national, pristine };
// derived visible/compact/isComplete. Country selector follows the admin
// listbox pattern (StatusPicker): own popover on --z-popover, mouse-only,
// click-outside/ESC close, selected row marked.

const FRESH: PhoneFieldValue = { country: 'RU', national: '', pristine: true };

interface Harness {
  /** Latest controlled value (mirrors the owner's state). */
  value: () => PhoneFieldValue;
  /** Change spy — every onChange the widget lifted. */
  onChange: Mock;
}

function renderPhoneField(initial: PhoneFieldValue = FRESH): Harness {
  const harness: Harness = { value: () => initial, onChange: vi.fn() };
  function Owner() {
    const [value, setValue] = useState(initial);
    harness.value = () => value;
    return (
      <PhoneField
        value={value}
        onChange={(v) => {
          harness.onChange(v);
          setValue(v);
        }}
      />
    );
  }
  render(<Owner />);
  return harness;
}

function openCountryList() {
  act(() => {
    fireEvent.click(screen.getByTestId('phone-country-select'));
  });
}

function selectCountry(iso: string) {
  openCountryList();
  act(() => {
    fireEvent.click(screen.getByTestId(`phone-country-select-option-${iso}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PhoneField — selector shell (spec §Виджет PhoneField)', () => {
  it('renders the selector «+7 Россия ⌄» and the remainder input (type=tel, dir=ltr, honest RU placeholder)', () => {
    renderPhoneField();
    const trigger = screen.getByTestId('phone-country-select');
    expect(trigger).toHaveTextContent('+7');
    expect(trigger).toHaveTextContent('Россия');

    const input = screen.getByTestId('phone-input') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input).toHaveAttribute('placeholder', '999 123-45-67');
    expect(input).toHaveValue('');
  });

  it('opens the listbox with the 9 dictionary countries, RU first, the bound row marked selected', () => {
    renderPhoneField();
    openCountryList();
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      '+7 Россия',
      '+375 Беларусь',
      '+49 Германия',
      '+7 Казахстан',
      '+371 Латвия',
      '+370 Литва',
      '+48 Польша',
      '+380 Украина',
      '+372 Эстония',
    ]);
    expect(screen.getByTestId('phone-country-select-option-RU')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('selects a country: lifts { country, national, pristine:false }, shows it in the trigger, closes the listbox', () => {
    const h = renderPhoneField();
    selectCountry('BY');
    expect(h.onChange).toHaveBeenCalledWith({
      country: 'BY',
      national: '',
      pristine: false,
    });
    expect(h.value()).toEqual({ country: 'BY', national: '', pristine: false });
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Беларусь');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('re-picking the already bound country changes nothing', () => {
    const h = renderPhoneField();
    selectCountry('RU');
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.value()).toEqual(FRESH);
  });

  it('closes the listbox on ESC and on click outside', () => {
    renderPhoneField();
    openCountryList();
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    openCountryList();
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('PhoneField — remainder typing (spec §Виджет PhoneField)', () => {
  function typeIntoInput(raw: string) {
    const input = screen.getByTestId('phone-input');
    act(() => {
      fireEvent.change(input, { target: { value: raw } });
    });
    return screen.getByTestId('phone-input') as HTMLInputElement;
  }

  it('lifts digits and groups them as-you-type for RU (9991234 → «999 123-4»), flipping pristine', () => {
    const h = renderPhoneField();
    const input = typeIntoInput('9991234');
    expect(h.onChange).toHaveBeenCalledWith({ country: 'RU', national: '9991234', pristine: false });
    expect(h.value()).toEqual({ country: 'RU', national: '9991234', pristine: false });
    expect(input.value).toBe('999 123-4');
  });

  it('ignores non-digit input: typed letters/«+» change nothing and leave the display grouped', () => {
    const h = renderPhoneField({ country: 'RU', national: '9991234', pristine: false });
    const before = h.onChange.mock.calls.length;

    const input = typeIntoInput('999 123-4abc');
    expect(input.value).toBe('999 123-4');
    expect(h.onChange.mock.calls.length).toBe(before);

    // A typed «+» is not entered either — the selector owns the country code.
    typeIntoInput('+999 123-4');
    expect(input.value).toBe('999 123-4');
    expect(h.onChange.mock.calls.length).toBe(before);
    expect(h.value().national).toBe('9991234');
  });

  it('groups a BY remainder under Belarus (min metadata keeps BY digits plain)', () => {
    const by = renderPhoneField({ country: 'BY', national: '291234567', pristine: false });
    expect((screen.getByTestId('phone-input') as HTMLInputElement).value).toBe('291234567');
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Беларусь');
    expect(by.value()).toEqual({ country: 'BY', national: '291234567', pristine: false });
  });

  it('groups an LV remainder as «23 123 456»', () => {
    renderPhoneField({ country: 'LV', national: '23123456', pristine: false });
    expect((screen.getByTestId('phone-input') as HTMLInputElement).value).toBe('23 123 456');
  });

  it('switches the placeholder to the honest template of the chosen country', () => {
    renderPhoneField();
    expect(screen.getByTestId('phone-input')).toHaveAttribute('placeholder', '999 123-45-67');
    selectCountry('BY');
    expect(screen.getByTestId('phone-input')).toHaveAttribute('placeholder', '29 123 45 67');
    selectCountry('LV');
    expect(screen.getByTestId('phone-input')).toHaveAttribute('placeholder', '23 123 456');
  });

  it('keeps the bound value verbatim while pristine (no reformat on render)', () => {
    renderPhoneField({ country: 'RU', national: '9996531803', pristine: true });
    expect(screen.getByTestId('phone-input')).toHaveValue('999 653-18-03');
  });
});

describe('PhoneField — paste of a «+»-leading string (spec §Виджет PhoneField)', () => {
  function pasteIntoInput(text: string) {
    const input = screen.getByTestId('phone-input');
    act(() => {
      fireEvent.paste(input, { clipboardData: { getData: () => text } });
    });
    return screen.getByTestId('phone-input') as HTMLInputElement;
  }

  it('a list-country paste selects the country and the parsed national remainder', () => {
    const h = renderPhoneField();
    pasteIntoInput('+375 29 123-45-67');
    expect(h.onChange).toHaveBeenCalledWith({
      country: 'BY',
      national: '291234567',
      pristine: false,
    });
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Беларусь');
    expect((screen.getByTestId('phone-input') as HTMLInputElement).value).toBe('291234567');
  });

  it('an out-of-list paste («+1 …») enters the «no country» state: digits stay, selector unchanged', () => {
    const h = renderPhoneField();
    pasteIntoInput('+1 555 123-45-67');
    expect(h.onChange).toHaveBeenCalledWith({
      country: null,
      national: '15551234567',
      pristine: false,
    });
    expect(h.value()).toEqual({ country: null, national: '15551234567', pristine: false });
    // Selector does not move (still RU) and the remainder shows raw digits.
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
    expect((screen.getByTestId('phone-input') as HTMLInputElement).value).toBe('15551234567');
    // No honest template while unbound.
    expect(screen.getByTestId('phone-input')).toHaveAttribute('placeholder', '');
  });

  it('a paste equal to the current value lifts nothing (pristine survives)', () => {
    const h = renderPhoneField();
    pasteIntoInput('+7 999 653-18-03');
    expect(h.onChange).toHaveBeenCalledTimes(1);
    pasteIntoInput('+79996531803');
    expect(h.onChange).toHaveBeenCalledTimes(1); // identical digits+country — no second lift
    expect(h.value()).toEqual({ country: 'RU', national: '9996531803', pristine: false });
  });

  it('a non-«+» paste goes through the ordinary change path (digits only, no country switch)', () => {
    const h = renderPhoneField();
    const input = screen.getByTestId('phone-input') as HTMLInputElement;
    act(() => {
      fireEvent.paste(input, { clipboardData: { getData: () => '9991234567' } });
      fireEvent.change(input, { target: { value: '9991234567' } });
    });
    expect(h.value()).toEqual({ country: 'RU', national: '9991234567', pristine: false });
    expect(input.value).toBe('999 123-45-67');
  });
});

describe('PhoneField — × clear and «без страны» exit (spec §Виджет PhoneField)', () => {
  it('× clears the remainder, resets to RU and lifts { RU, "", pristine:false }', () => {
    const h = renderPhoneField({ country: 'BY', national: '291234567', pristine: false });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    });
    expect(h.onChange).toHaveBeenCalledWith({ country: 'RU', national: '', pristine: false });
    expect(h.value()).toEqual({ country: 'RU', national: '', pristine: false });
    expect(screen.getByTestId('phone-country-select')).toHaveTextContent('Россия');
    expect(screen.getByTestId('phone-input')).toHaveValue('');
    expect(screen.getByTestId('phone-input')).toHaveAttribute('placeholder', '999 123-45-67');
  });

  it('× leaves a no-country state too (reset covers it)', () => {
    const h = renderPhoneField({ country: null, national: '15551234567', pristine: false });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    });
    expect(h.value()).toEqual({ country: 'RU', national: '', pristine: false });
  });

  it('× on an already fresh field lifts nothing', () => {
    const h = renderPhoneField();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    });
    expect(h.onChange).not.toHaveBeenCalled();
    expect(h.value()).toEqual(FRESH);
  });

  it('× on a pristine loaded number makes it dirty-empty (a save must not rewrite silently)', () => {
    const h = renderPhoneField({ country: 'RU', national: '9996531803', pristine: true });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    });
    expect(h.onChange).toHaveBeenCalledWith({ country: 'RU', national: '', pristine: false });
  });

  it('choosing a country exits «без страны»: binds, keeps digits, regroups under the new country', () => {
    const h = renderPhoneField({ country: null, national: '15551234567', pristine: false });
    selectCountry('DE');
    expect(h.onChange).toHaveBeenCalledWith({
      country: 'DE',
      national: '15551234567',
      pristine: false,
    });
    expect((screen.getByTestId('phone-input') as HTMLInputElement).value).toBe('15551234567');
    expect(screen.getByTestId('phone-input')).toHaveAttribute('placeholder', '1512 3456789');
  });

  it('switching the country mid-entry keeps the typed digits and reformats (RU → LV)', () => {
    const h = renderPhoneField();
    act(() => {
      fireEvent.change(screen.getByTestId('phone-input'), { target: { value: '9991234567' } });
    });
    expect(h.value()).toEqual({ country: 'RU', national: '9991234567', pristine: false });

    selectCountry('LV');
    expect(h.value()).toEqual({ country: 'LV', national: '9991234567', pristine: false });
    // LV min metadata does not group a 10-digit tail — digits shown as typed.
    expect((screen.getByTestId('phone-input') as HTMLInputElement).value).toBe('9991234567');
  });
});

describe('PhoneField — derived visible/compact/isComplete (spec §Виджет PhoneField)', () => {
  it('phoneVisible groups per the bound country and degrades to raw digits unbound', () => {
    expect(phoneVisible({ country: 'RU', national: '9991234567', pristine: false })).toBe(
      '999 123-45-67',
    );
    expect(phoneVisible({ country: 'LV', national: '23123456', pristine: false })).toBe(
      '23 123 456',
    );
    expect(phoneVisible({ country: 'BY', national: '291234567', pristine: true })).toBe(
      '291234567',
    );
    expect(phoneVisible({ country: null, national: '15551234567', pristine: false })).toBe(
      '15551234567',
    );
    expect(phoneVisible({ country: 'RU', national: '', pristine: true })).toBe('');
  });

  it('phoneCompact builds «+<код><национальные>» and is undefined (») for «без страны»', () => {
    expect(phoneCompact({ country: 'RU', national: '9996531803', pristine: false })).toBe(
      '+79996531803',
    );
    expect(phoneCompact({ country: 'BY', national: '291234567', pristine: false })).toBe(
      '+375291234567',
    );
    expect(phoneCompact({ country: 'KZ', national: '7011234567', pristine: false })).toBe(
      '+77011234567',
    );
    // «без страны» → compact не определён (пустая строка), даже с цифрами.
    expect(phoneCompact({ country: null, national: '15551234567', pristine: false })).toBe('');
    // пустой остаток → тоже ''.
    expect(phoneCompact({ country: 'RU', national: '', pristine: true })).toBe('');
  });

  it('phoneIsComplete = bound country && isPossiblePhoneNumber(остаток, страна)', () => {
    // Full RU number.
    expect(phoneIsComplete({ country: 'RU', national: '9991234567', pristine: false })).toBe(true);
    // Too short.
    expect(phoneIsComplete({ country: 'RU', national: '9991234', pristine: false })).toBe(false);
    // Too long (11 national digits for RU).
    expect(phoneIsComplete({ country: 'RU', national: '99999999999', pristine: false })).toBe(
      false,
    );
    // BY/LV full numbers.
    expect(phoneIsComplete({ country: 'BY', national: '291234567', pristine: false })).toBe(true);
    expect(phoneIsComplete({ country: 'LV', national: '23123456', pristine: false })).toBe(true);
    // «без страны» → never complete.
    expect(phoneIsComplete({ country: null, national: '15551234567', pristine: false })).toBe(
      false,
    );
    // Empty.
    expect(phoneIsComplete({ country: 'RU', national: '', pristine: true })).toBe(false);
  });
});

describe('PhoneField — forwarded input props (consumers: Tasks 4/6/7/8)', () => {
  it('forwards id, autoComplete, name, required and aria-label to the remainder input', () => {
    render(
      <PhoneField
        value={FRESH}
        onChange={vi.fn()}
        id="login-phone"
        name="phone"
        autoComplete="tel"
        required
        aria-label="Телефон"
      />,
    );
    const input = screen.getByTestId('phone-input');
    expect(input).toHaveAttribute('id', 'login-phone');
    expect(input).toHaveAttribute('name', 'phone');
    expect(input).toHaveAttribute('autocomplete', 'tel');
    expect(input).toHaveAttribute('required');
    expect(input).toHaveAttribute('aria-label', 'Телефон');
  });

  it('readOnly freezes the whole field: input readonly, selector and × disabled', () => {
    render(<PhoneField value={FRESH} onChange={vi.fn()} readOnly />);
    expect(screen.getByTestId('phone-input')).toHaveAttribute('readonly');
    expect(screen.getByTestId('phone-country-select')).toBeDisabled();
    expect(screen.getByTestId('phone-clear')).toBeDisabled();
    act(() => {
      fireEvent.click(screen.getByTestId('phone-country-select'));
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('disabled disables the input, selector and ×', () => {
    render(<PhoneField value={FRESH} onChange={vi.fn()} disabled />);
    expect(screen.getByTestId('phone-input')).toBeDisabled();
    expect(screen.getByTestId('phone-country-select')).toBeDisabled();
    expect(screen.getByTestId('phone-clear')).toBeDisabled();
  });

  it('forwards onFocus/onBlur from the remainder input', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<PhoneField value={FRESH} onChange={vi.fn()} onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByTestId('phone-input');
    act(() => {
      fireEvent.focus(input);
    });
    expect(onFocus).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.blur(input);
    });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
