import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ServiceModal } from '../app/(main)/services/components/ServiceModal';
import type { ServiceModalProps } from '../app/(main)/services/components/ServiceModal';

// ServiceModal's materials picker reads the materials dictionary through
// useMaterialsRaw — the modal-level scenarios here don't exercise it, so a
// static empty list is enough (ServicesTable.test.tsx covers the picker).
vi.mock('@/hooks/useMaterials', () => ({
  useMaterialsRaw: () => ({ data: [] }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

/**
 * GH #203 fixture: a service WITHOUT an upper age bound (max_age: null).
 * min_age = 5 — any bogus numeric substitution (0) would violate the
 * cross-rule «от ≤ до» and block the save (the reported bug).
 */
const NULL_AGE_SERVICE: Record<string, unknown> = {
  id: 'svc-null',
  title: 'Гончарное дело',
  description: 'Лепка из глины',
  image_url: '',
  specialty: 'Керамика',
  min_age: 5,
  max_age: null,
  duration: 90,
  record_info: '',
  tariffs: [
    { id: 't-1', service_id: 'svc-null', title: 'Базовый', description: null, price: 2000 },
  ],
  tags: [],
  materials: [],
  archived: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderModal(overrides: Partial<ServiceModalProps> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ServiceModal
      mode="edit"
      service={NULL_AGE_SERVICE}
      onSubmit={onSubmit}
      onClose={onClose}
      title="Редактировать услугу"
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

function inputByLabel(label: RegExp, index = 0): HTMLInputElement {
  return screen.getAllByLabelText(label)[index] as HTMLInputElement;
}

/** The top-level «Возраст от» input. */
function minAgeInput(): HTMLInputElement {
  return inputByLabel(/^Возраст от/);
}

/** The top-level «Возраст до» input. */
function maxAgeInput(): HTMLInputElement {
  return inputByLabel(/^Возраст до/);
}

function changeValue(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function clickSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
}

/**
 * Error text rendered under a field: FieldRenderer wires aria-describedby to
 * the error span only when an error exists (a11y contract, spec §2 п.4).
 */
function errorTextFor(input: HTMLInputElement): string | null {
  const describedBy = input.getAttribute('aria-describedby');
  if (!describedBy) return null;
  return document.getElementById(describedBy)?.textContent ?? null;
}

/** Open the create modal and fill everything required except «Возраст до». */
function renderCreateWithTariff() {
  const rendered = renderModal({
    mode: 'create',
    service: null,
    title: 'Новая услуга',
  });
  changeValue(inputByLabel(/^Название/), 'Новая услуга');
  changeValue(inputByLabel(/Длительность/), '90');
  fireEvent.click(screen.getByRole('button', { name: '+ Добавить тариф' }));
  // Tariff fields duplicate the top-level «Название» label — tariff one is [1].
  changeValue(inputByLabel(/^Название/, 1), 'Базовый');
  return rendered;
}

// ─── §4.3 Edit: service without the upper age bound ────────────────────────

describe('ServiceModal — edit service with max_age null (GH #203 §4.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Task item 3 — named pre-check of the fixture state on open.
  it('opens with «Возраст до» empty (not 0) and placeholder «без ограничения»', () => {
    renderModal();

    // jest-dom maps an empty number input to null — toHaveValue(null) is the
    // canonical empty assert and still fails for the buggy 0 substitution.
    expect(maxAgeInput()).toHaveValue(null);
    expect(maxAgeInput()).toHaveAttribute('placeholder', 'без ограничения');
    // The lower bound keeps its value — only max_age inits empty.
    expect(minAgeInput()).toHaveValue(5);
  });

  it('saves a null-max_age service: submit passes, payload carries max_age null', async () => {
    const { onSubmit } = renderModal();

    changeValue(inputByLabel(/^Название/), 'Гончарное дело 2');
    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.max_age).toBeNull();
    expect(screen.queryByText('Не может быть меньше возраста от')).not.toBeInTheDocument();
    expect(screen.queryByText('Не может быть больше возраста до')).not.toBeInTheDocument();
  });

  it('cross-rule: «от = 10, до = 5» → both errors, no submit', () => {
    const { onSubmit } = renderModal();

    changeValue(minAgeInput(), '10');
    changeValue(maxAgeInput(), '5');
    clickSave();

    expect(screen.getByText('Не может быть больше возраста до')).toBeInTheDocument();
    expect(screen.getByText('Не может быть меньше возраста от')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cross-rule: «от = 10, до = 14» → saves', async () => {
    const { onSubmit } = renderModal();

    changeValue(minAgeInput(), '10');
    changeValue(maxAgeInput(), '14');
    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.max_age).toBe(14);
  });

  it('cross-rule: clearing «до» after a violation → saves without errors', async () => {
    const { onSubmit } = renderModal();

    changeValue(minAgeInput(), '10');
    changeValue(maxAgeInput(), '5');
    clickSave();
    expect(screen.getByText('Не может быть меньше возраста от')).toBeInTheDocument();

    changeValue(maxAgeInput(), '');
    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Не может быть меньше возраста от')).not.toBeInTheDocument();
    expect(screen.queryByText('Не может быть больше возраста до')).not.toBeInTheDocument();
  });

  it('cross-rule: «до = 0» with «от = 0» → saves (range 0–18, no false error)', async () => {
    const { onSubmit } = renderModal();

    changeValue(minAgeInput(), '0');
    changeValue(maxAgeInput(), '0');
    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.max_age).toBe(0);
    expect(payload.min_age).toBe(0);
    expect(screen.queryByText('Не может быть меньше возраста от')).not.toBeInTheDocument();
  });
});

// ─── §4.4 Create: empty «до» travels as null ────────────────────────────────

describe('ServiceModal — create with empty max_age (GH #203 §4.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create with a tariff and empty «до» → mutation payload has max_age null', async () => {
    const { onSubmit } = renderCreateWithTariff();

    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.max_age).toBeNull();
    // Unfilled min_age keeps the 0-init semantics («с рождения»).
    expect(payload.min_age).toBe(0);
    // The tariff went through untouched (+ GH #284: audience defaults to "all").
    expect(payload.tariffs).toEqual([
      { title: 'Базовый', price: 0, description: '', audience: 'all' },
    ]);
  });

  it('create init: «Возраст от» is 0 (0-init preserved, only max_age is empty)', () => {
    renderModal({ mode: 'create', service: null, title: 'Новая услуга' });

    expect(minAgeInput()).toHaveValue(0);
    expect(maxAgeInput()).toHaveValue(null);
  });
});

// ─── §4.5 Required numbers + tariff item validation ─────────────────────────

describe('ServiceModal — required numbers and tariff item fields (GH #203 §4.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('empty tariff price → client-side required error at the price field, no submit', () => {
    const { onSubmit } = renderCreateWithTariff();

    changeValue(inputByLabel(/^Цена/), '');
    clickSave();

    const priceInput = inputByLabel(/^Цена/);
    expect(errorTextFor(priceInput)).toBe('Обязательное поле');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('tariff price 0 is accepted (min 0 — valid value, not «empty»)', async () => {
    const { onSubmit } = renderCreateWithTariff();

    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    const tariffs = payload.tariffs as Record<string, unknown>[];
    expect(tariffs[0].price).toBe(0);
  });

  it('duration 0 → «Минимум: 15» (range check alive)', () => {
    const { onSubmit } = renderModal({ mode: 'create', service: null, title: 'Новая услуга' });

    changeValue(inputByLabel(/^Название/), 'Новая услуга');
    clickSave();

    expect(screen.getByText('Минимум: 15')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('empty tariff title → required error at the tariff title field, no submit', () => {
    const { onSubmit } = renderModal({
      mode: 'create',
      service: null,
      title: 'Новая услуга',
    });

    changeValue(inputByLabel(/^Название/), 'Новая услуга');
    changeValue(inputByLabel(/Длительность/), '90');
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить тариф' }));
    // Tariff title stays at its '' init.
    clickSave();

    const tariffTitle = inputByLabel(/^Название/, 1);
    expect(errorTextFor(tariffTitle)).toBe('Обязательное поле');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ─── Tariff audience select (GH #284 spec §5: ServiceModal NestedList) ─────

describe('ServiceModal — tariff audience select (GH #284)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('edit prefill: select restores the tariff audience and offers детский/взрослый/единый', () => {
    renderModal({
      service: {
        ...NULL_AGE_SERVICE,
        tariffs: [
          { id: 't-1', service_id: 'svc-null', title: 'Детский', description: null, price: 1500, audience: 'kid' },
        ],
      },
    });

    // Programmatic label: «Возрастная группа: {tariff title}» — the row's
    // title, not a column header (spec §5 a11y).
    const select = screen.getByLabelText('Возрастная группа: Детский') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    // Canonical values, Russian lowercase labels (owner decision).
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ['kid', 'детский'],
      ['adult', 'взрослый'],
      ['all', 'единый'],
    ]);
    expect(select.value).toBe('kid');
  });

  it('new tariff row defaults to «единый» (all) and the audience round-trips on submit', async () => {
    const { onSubmit } = renderCreateWithTariff();

    // Default mirrors TariffCreateSchema (optional, default "all").
    const select = screen.getByLabelText('Возрастная группа: Базовый') as HTMLSelectElement;
    expect(select.value).toBe('all');

    fireEvent.change(select, { target: { value: 'kid' } });
    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tariffs).toEqual([
      { title: 'Базовый', price: 0, description: '', audience: 'kid' },
    ]);
  });

  it('label tracks the tariff title live (renaming retargets the programmatic label)', () => {
    renderModal({
      service: {
        ...NULL_AGE_SERVICE,
        tariffs: [
          { id: 't-1', service_id: 'svc-null', title: 'Базовый', description: null, price: 2000, audience: 'all' },
        ],
      },
    });

    expect(screen.getByLabelText('Возрастная группа: Базовый')).toBeInTheDocument();
    changeValue(inputByLabel(/^Название/, 1), 'Холст малый');
    expect(screen.getByLabelText('Возрастная группа: Холст малый')).toBeInTheDocument();
    expect(screen.queryByLabelText('Возрастная группа: Базовый')).not.toBeInTheDocument();
  });

  it('no duplicate-group validation: two kid tariffs save without errors (spec §2 п.2)', async () => {
    const { onSubmit } = renderModal({
      service: {
        ...NULL_AGE_SERVICE,
        tariffs: [
          { id: 't-1', service_id: 'svc-null', title: 'Детский малый', description: null, price: 1500, audience: 'kid' },
          { id: 't-2', service_id: 'svc-null', title: 'Детский большой', description: null, price: 2500, audience: 'kid' },
        ],
      },
    });

    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    const tariffs = payload.tariffs as Record<string, unknown>[];
    // Duplicate kid groups are legal (canvas case) — no validation kicks in
    // and both audiences survive the round-trip untouched.
    expect(tariffs.map((t) => [t.title, t.audience])).toEqual([
      ['Детский малый', 'kid'],
      ['Детский большой', 'kid'],
    ]);
    expect(screen.queryByText('Обязательное поле')).not.toBeInTheDocument();
  });

  it('a tariff without audience (legacy shape) falls back to «единый» in the editor', () => {
    renderModal({
      service: {
        ...NULL_AGE_SERVICE,
        tariffs: [
          { id: 't-1', service_id: 'svc-null', title: 'Базовый', description: null, price: 2000 },
        ],
      },
    });

    expect(
      (screen.getByLabelText('Возрастная группа: Базовый') as HTMLSelectElement).value,
    ).toBe('all');
  });
});

// ─── Submit normalization: '' → null ONLY for max_age ───────────────────────

describe('ServiceModal — submit normalization (GH #203 §2 п.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("'' → null only for max_age; other cleared fields are NOT nulled", async () => {
    const { onSubmit } = renderModal();

    changeValue(maxAgeInput(), '');
    changeValue(minAgeInput(), '');
    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.max_age).toBeNull();
    // Only max_age is normalized — a cleared non-normalized field keeps its
    // raw form value (min_age is optional; create re-inits it to 0).
    expect(payload.min_age).toBe('');
  });
});
