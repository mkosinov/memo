import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ServiceModal } from '../app/(main)/services/components/ServiceModal';
import type { ServiceModalProps } from '../app/(main)/services/components/ServiceModal';

// ServiceModal's materials picker reads the materials dictionary through
// useMaterialsRaw — the modal-level scenarios here don't exercise it, so a
// static empty list is enough (ServicesTable.test.tsx covers the picker).
vi.mock('@/hooks/useMaterials', () => ({
  useMaterialsRaw: () => ({ data: [] }),
}));

// GH #328: the tags picker searches via getTags — and the modal-level
// scenarios DO exercise it: addTagViaTypeahead re-mocks mockGetTags per call
// (search → dropdown option → chip). The beforeEach static empty page is
// only the default for scenarios that don't type into the picker.
const mockGetTags = vi.fn();
vi.mock('@memo/api-client', () => ({
  getTags: (...args: unknown[]) => mockGetTags(...args),
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

/** GH #328 fixture: a service with one linked tag (read shape {id, title}). */
const TAGGED_SERVICE: Record<string, unknown> = {
  ...NULL_AGE_SERVICE,
  id: 'svc-tagged',
  tags: [{ id: 'tag-1', title: 'Гуашь' }],
};

/** GH #328 fixture: a second tag returned by the typeahead (getTags page). */
const TAG_AQUARELLE = { id: 'tag-aq', title: 'Акварель' };

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

// ─── GH #328: tags field (prefill chips + tag_ids in payload) ───────────────

describe('ServiceModal — tags field (GH #328)', () => {
  /** Debounce-driven flow (PhotoModal precedent): fake timers around the 300ms. */
  function typeAndDebounce(input: HTMLElement, value: string) {
    vi.useFakeTimers();
    try {
      fireEvent.change(input, { target: { value } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }
  }

  /**
   * Add a tag chip through the typeahead: search → dropdown option → click.
   * Returns nothing; the chip presence is the caller's assertion.
   */
  async function addTagViaTypeahead(tag: { id: string; title: string }) {
    mockGetTags.mockResolvedValue({ items: [tag], total: 1, page: 1, per_page: 10 });
    typeAndDebounce(screen.getByRole('textbox', { name: 'Теги' }), tag.title.slice(0, 2));
    const option = await screen.findByRole('option', { name: tag.title });
    fireEvent.click(option);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTags.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 10 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('edit: prefilled tag renders as a chip and travels as tag_ids on save', async () => {
    const { onSubmit } = renderModal({ service: TAGGED_SERVICE });

    // The chip is visible with its title and a removal button (a11y §6.2).
    expect(screen.getByText('Гуашь')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Удалить тег Гуашь' }),
    ).toBeInTheDocument();
    // The search input is wired to the visible «Теги» label.
    expect(
      screen.getByRole('textbox', { name: 'Теги' }),
    ).toHaveAttribute('placeholder', 'Введите название тега...');

    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tag_ids).toEqual(['tag-1']);
  });

  it('payload: tag_ids is a bare id array — never {id,title} objects', async () => {
    const { onSubmit } = renderModal({ service: TAGGED_SERVICE });
    await addTagViaTypeahead(TAG_AQUARELLE);

    clickSave();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    // ids only, in selection order — the wire shape ServiceUpdate.tag_ids.
    expect(payload.tag_ids).toEqual(['tag-1', 'tag-aq']);
    expect((payload.tag_ids as unknown[]).every((id) => typeof id === 'string')).toBe(true);
  });

  it('dedupe: re-picking an already-chipped tag does NOT add a second chip', async () => {
    const { onSubmit } = renderModal({ service: TAGGED_SERVICE });

    // The typeahead returns the ALREADY linked tag (server does not exclude
    // existing picks) — selecting it again must be a no-op.
    await addTagViaTypeahead({ id: 'tag-1', title: 'Гуашь' });

    expect(screen.getAllByText('Гуашь')).toHaveLength(1);

    clickSave();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tag_ids).toEqual(['tag-1']);
  });

  it('dirty close: adding a chip makes «Отмена» confirm; decline keeps the modal open', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onClose } = renderModal();

    await addTagViaTypeahead(TAG_AQUARELLE);
    // The chip landed — the form is dirty.
    expect(screen.getByText('Акварель')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dirty close: removing a prefilled chip is dirty too; accept closes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onClose } = renderModal({ service: TAGGED_SERVICE });

    fireEvent.click(screen.getByRole('button', { name: 'Удалить тег Гуашь' }));
    expect(screen.queryByText('Гуашь')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('clean close: untouched tags field closes without the confirm prompt', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onClose } = renderModal({ service: TAGGED_SERVICE });

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // Render-fact: SERVICE_FIELDS and the FieldRenderer 'tags' branch must stay
  // in sync — a config entry without a render branch (or vice versa) leaves
  // an «empty spot» in the form. Both ends are asserted by DOM contract.
  it('render-fact: the tags field is present — label + search input wired via htmlFor', () => {
    renderModal();

    const search = screen.getByRole('textbox', { name: 'Теги' });
    expect(search).toBeInTheDocument();
    // The visible label binds to the input (a11y §6.2 — useId + htmlFor).
    const label = screen.getByText('Теги', { selector: 'label' });
    expect(label).toHaveAttribute('for', search.id);
  });

  it('searches tags via getTags({q, per_page: 10}) after the 300ms debounce (min 2 chars)', async () => {
    renderModal();

    typeAndDebounce(screen.getByRole('textbox', { name: 'Теги' }), 'Ак');

    await waitFor(() => {
      expect(mockGetTags).toHaveBeenCalledWith({ q: 'Ак', per_page: 10 });
    });
  });
});
