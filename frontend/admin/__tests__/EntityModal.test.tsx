import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { EntityModal } from '../app/components/modal/EntityModal';
import type { FieldConfig } from '../app/components/modal/EntityModal';
import { TagsSelect } from '../app/components/modal/EntityModal/TagsSelect';

// ─── Reusable field configs for tests ─────────────────────────────────────

const textFields: FieldConfig[] = [
  { type: 'text', key: 'name', label: 'Название', placeholder: 'Введите название', required: true },
  { type: 'text', key: 'address', label: 'Адрес', disabled: true },
];

const numberFields: FieldConfig[] = [
  { type: 'number', key: 'price', label: 'Цена', min: 0, max: 100000, required: true, suffix: '₽' },
];

const textareaFields: FieldConfig[] = [
  { type: 'textarea', key: 'description', label: 'Описание', rows: 4, placeholder: 'Опишите...' },
];

const selectFields: FieldConfig[] = [
  {
    type: 'select', key: 'type', label: 'Тип', required: true,
    options: [
      { value: 'adult', label: 'Взрослый' },
      { value: 'child', label: 'Детский' },
    ],
  },
];

const nestedListFields: FieldConfig[] = [
  {
    type: 'nested-list',
    key: 'tariffs',
    label: 'Тарифы',
    itemLabel: 'Тариф',
    addButtonText: '+ Добавить тариф',
    emptyText: 'Нет тарифов',
    itemFields: [
      { type: 'text', key: 'title', label: 'Название', required: true },
      { type: 'number', key: 'price', label: 'Цена', min: 0, required: true },
      { type: 'textarea', key: 'description', label: 'Описание' },
    ],
  },
];

const ageFields: FieldConfig[] = [
  { type: 'number', key: 'min_age', label: 'Возраст от', min: 0, max: 99 },
  { type: 'number', key: 'max_age', label: 'Возраст до', min: 0, max: 99 },
];

// ─── EntityModal Tests ────────────────────────────────────────────────────

describe('EntityModal', () => {
  const defaultProps = {
    mode: 'create' as const,
    entity: null,
    fields: textFields,
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    title: 'Создать локацию',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Rendering ──────────────────────────────────────────────────────────

  it('renders the dialog with correct title', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Создать локацию')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<EntityModal {...defaultProps} subtitle="Заполните форму" />);
    expect(screen.getByText('Заполните форму')).toBeInTheDocument();
  });

  it('renders text field with label', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByLabelText(/Название/)).toBeInTheDocument();
  });

  it('renders number field with suffix', () => {
    render(<EntityModal {...defaultProps} fields={numberFields} />);
    expect(screen.getByLabelText(/Цена/)).toBeInTheDocument();
    expect(screen.getByText('₽')).toBeInTheDocument();
  });

  it('renders textarea field', () => {
    render(<EntityModal {...defaultProps} fields={textareaFields} />);
    expect(screen.getByLabelText(/Описание/)).toBeInTheDocument();
  });

  it('renders select field with options', () => {
    render(<EntityModal {...defaultProps} fields={selectFields} />);
    const select = screen.getByLabelText(/Тип/);
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Взрослый')).toBeInTheDocument();
    expect(screen.getByText('Детский')).toBeInTheDocument();
  });

  it('renders required indicator for required fields', () => {
    render(<EntityModal {...defaultProps} />);
    const label = screen.getByText('*');
    expect(label).toBeInTheDocument();
  });

  it('renders save and cancel buttons', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
    expect(screen.getByText('Отмена')).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByLabelText('Закрыть')).toBeInTheDocument();
  });

  // ── Create vs Edit mode ────────────────────────────────────────────────

  it('shows empty form in create mode', () => {
    render(<EntityModal {...defaultProps} mode="create" />);
    const nameInput = screen.getByLabelText(/Название/) as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });

  it('pre-fills form in edit mode', () => {
    render(
      <EntityModal
        {...defaultProps}
        mode="edit"
        entity={{ name: 'Альпика', address: 'Альпика, 1 этаж' }}
        title="Редактировать локацию"
      />,
    );
    const nameInput = screen.getByLabelText(/Название/) as HTMLInputElement;
    expect(nameInput.value).toBe('Альпика');
  });

  it('shows different title for edit mode', () => {
    render(
      <EntityModal
        {...defaultProps}
        mode="edit"
        entity={{ name: 'Альпика' }}
        title="Редактировать локацию"
      />,
    );
    expect(screen.getByText('Редактировать локацию')).toBeInTheDocument();
  });

  // ── Wide mode ──────────────────────────────────────────────────────────

  it('applies wide max-width when width=wide', () => {
    const { container } = render(<EntityModal {...defaultProps} width="wide" />);
    const modal = container.querySelector('[role="dialog"] > div:last-child') as HTMLElement;
    expect(modal.className).toContain('max-w-[800px]');
  });

  it('applies default max-width by default', () => {
    const { container } = render(<EntityModal {...defaultProps} />);
    const modal = container.querySelector('[role="dialog"] > div:last-child') as HTMLElement;
    expect(modal.className).toContain('max-w-[600px]');
  });

  // ── Close behavior ────────────────────────────────────────────────────

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<EntityModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<EntityModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Отмена'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<EntityModal {...defaultProps} onClose={onClose} />);
    const backdrop = screen.getByRole('dialog').querySelector('.bg-black\\/30') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on escape when form is dirty', () => {
    const onClose = vi.fn();
    // Mock window.confirm to reject
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<EntityModal {...defaultProps} onClose={onClose} />);
    // Make form dirty by typing
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'test' } });
    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockRestore();
  });

  it('shows confirm dialog when form is dirty and close is attempted', () => {
    const onClose = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<EntityModal {...defaultProps} onClose={onClose} />);
    // Make form dirty
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'test' } });
    // Close
    fireEvent.click(screen.getByLabelText('Закрыть'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    vi.mocked(window.confirm).mockRestore();
  });

  // ── Validation ─────────────────────────────────────────────────────────

  it('shows error when required text field is empty on submit', async () => {
    render(<EntityModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Сохранить'));
    expect(await screen.findByText('Обязательное поле')).toBeInTheDocument();
  });

  it('does not call onSubmit when validation fails', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EntityModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Сохранить'));
    // Wait a tick for async validation
    await new Promise((r) => setTimeout(r, 0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when required select field is empty on submit', async () => {
    render(<EntityModal {...defaultProps} fields={selectFields} />);
    fireEvent.click(screen.getByText('Сохранить'));
    expect(await screen.findByText('Обязательное поле')).toBeInTheDocument();
  });

  it('validates number min bound', async () => {
    render(<EntityModal {...defaultProps} fields={numberFields} />);
    fireEvent.change(screen.getByLabelText(/Цена/), { target: { value: '-5' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(await screen.findByText('Минимум: 0')).toBeInTheDocument();
  });

  it('validates number max bound', async () => {
    render(<EntityModal {...defaultProps} fields={numberFields} />);
    fireEvent.change(screen.getByLabelText(/Цена/), { target: { value: '200000' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(await screen.findByText('Максимум: 100000')).toBeInTheDocument();
  });

  it('validates min_age <= max_age cross-field', async () => {
    render(<EntityModal {...defaultProps} fields={ageFields} />);
    fireEvent.change(screen.getByLabelText(/Возраст от/), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText(/Возраст до/), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Сохранить'));
    expect(await screen.findByText('Не может быть больше возраста до')).toBeInTheDocument();
    expect(await screen.findByText('Не может быть меньше возраста от')).toBeInTheDocument();
  });

  it('clears error when user starts typing in a field with error', async () => {
    render(<EntityModal {...defaultProps} />);
    // Submit to trigger validation errors
    fireEvent.click(screen.getByText('Сохранить'));
    expect(await screen.findByText('Обязательное поле')).toBeInTheDocument();
    // Type in the field to clear the error
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'A' } });
    // Error should be cleared
    expect(screen.queryByText('Обязательное поле')).not.toBeInTheDocument();
  });

  // ── Submit ─────────────────────────────────────────────────────────────

  it('calls onSubmit with form data on valid submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EntityModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'Новая локация' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Новая локация' });
  });

  it('calls onSubmit with all field values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const allFields: FieldConfig[] = [
      { type: 'text', key: 'name', label: 'Название', required: true },
      { type: 'number', key: 'price', label: 'Цена', min: 0 },
      { type: 'select', key: 'type', label: 'Тип', options: [{ value: 'a', label: 'A' }] },
    ];
    render(<EntityModal {...defaultProps} fields={allFields} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/Цена/), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/Тип/), { target: { value: 'a' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Test', price: 100, type: 'a' });
  });

  it('closes modal after successful submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<EntityModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'OK' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close modal on failed submit', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('API error'));
    const onClose = vi.fn();
    render(<EntityModal {...defaultProps} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'Fail' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Loading state ──────────────────────────────────────────────────────

  it('disables submit button during loading', async () => {
    let resolveSubmit: () => void;
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveSubmit = resolve; }),
    );
    render(<EntityModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Название/), { target: { value: 'Loading' } });
    fireEvent.click(screen.getByText('Сохранить'));

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Сохранение...')).toBeInTheDocument();
    expect(screen.getByText('Сохранение...')).toBeDisabled();

    resolveSubmit!();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('shows "Сохранить" text when not submitting', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
    expect(screen.getByText('Сохранить')).not.toBeDisabled();
  });
});

// ─── NestedList Tests ─────────────────────────────────────────────────────

describe('EntityModal — nested-list', () => {
  const defaultProps = {
    mode: 'create' as const,
    entity: null,
    fields: nestedListFields,
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    title: 'Создать услугу',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the nested list label', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByText('Тарифы')).toBeInTheDocument();
  });

  it('shows empty text when no items', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByText('Нет тарифов')).toBeInTheDocument();
  });

  it('shows add button', () => {
    render(<EntityModal {...defaultProps} />);
    expect(screen.getByText('+ Добавить тариф')).toBeInTheDocument();
  });

  it('adds a new item when add button is clicked', () => {
    render(<EntityModal {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Добавить тариф'));
    expect(screen.getByText('Тариф 1')).toBeInTheDocument();
    // Empty text should no longer appear
    expect(screen.queryByText('Нет тарифов')).not.toBeInTheDocument();
  });

  it('renders fields inside each nested item', () => {
    render(<EntityModal {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Добавить тариф'));
    // Should have nested field labels
    expect(screen.getByText('Название', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Цена', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Описание', { selector: 'label' })).toBeInTheDocument();
  });

  it('removes an item when delete button is clicked', () => {
    render(<EntityModal {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Добавить тариф'));
    expect(screen.getByText('Тариф 1')).toBeInTheDocument();
    // Click the delete button (trash icon)
    const deleteBtn = screen.getByLabelText('Удалить Тариф');
    fireEvent.click(deleteBtn);
    expect(screen.queryByText('Тариф 1')).not.toBeInTheDocument();
    expect(screen.getByText('Нет тарифов')).toBeInTheDocument();
  });

  it('adds multiple items', () => {
    render(<EntityModal {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Добавить тариф'));
    fireEvent.click(screen.getByText('+ Добавить тариф'));
    expect(screen.getByText('Тариф 1')).toBeInTheDocument();
    expect(screen.getByText('Тариф 2')).toBeInTheDocument();
  });

  it('allows editing nested item fields', () => {
    render(<EntityModal {...defaultProps} />);
    fireEvent.click(screen.getByText('+ Добавить тариф'));
    // Find the first text input within the nested list (the title field)
    const titleInputs = screen.getAllByLabelText(/Название/);
    fireEvent.change(titleInputs[0], { target: { value: 'Взрослый' } });
    expect((titleInputs[0] as HTMLInputElement).value).toBe('Взрослый');
  });

  it('includes nested data in onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EntityModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('+ Добавить тариф'));
    // Fill title
    const titleInputs = screen.getAllByLabelText(/Название/);
    fireEvent.change(titleInputs[0], { target: { value: 'Тариф 1' } });
    fireEvent.click(screen.getByText('Сохранить'));
    await new Promise((r) => setTimeout(r, 10));
    expect(onSubmit).toHaveBeenCalledWith({
      tariffs: [{ title: 'Тариф 1', price: 0, description: '' }],
    });
  });

  it('pre-fills nested list from entity in edit mode', () => {
    render(
      <EntityModal
        {...defaultProps}
        mode="edit"
        entity={{
          tariffs: [
            { title: 'Взрослый', price: 3500, description: '' },
            { title: 'Детский', price: 2500, description: '' },
          ],
        }}
        title="Редактировать услугу"
      />,
    );
    expect(screen.getByText('Тариф 1')).toBeInTheDocument();
    expect(screen.getByText('Тариф 2')).toBeInTheDocument();
  });
});

// ─── TagsSelect Tests ─────────────────────────────────────────────────────

describe('TagsSelect', () => {
  const mockTags = [
    { id: 'tag1', name: 'Масло' },
    { id: 'tag2', name: 'Акварель' },
    { id: 'tag3', name: 'Карандаш' },
  ];

  it('renders selected tags as chips', () => {
    render(
      <TagsSelect
        selected={[mockTags[0], mockTags[1]]}
        fetchTags={vi.fn().mockResolvedValue(mockTags)}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Масло')).toBeInTheDocument();
    expect(screen.getByText('Акварель')).toBeInTheDocument();
  });

  it('renders + Тег button', () => {
    render(
      <TagsSelect
        selected={[]}
        fetchTags={vi.fn().mockResolvedValue(mockTags)}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('+ Тег')).toBeInTheDocument();
  });

  it('toggles dropdown when + Тег is clicked', async () => {
    render(
      <TagsSelect
        selected={[]}
        fetchTags={vi.fn().mockResolvedValue(mockTags)}
        onChange={vi.fn()}
      />,
    );
    // Click + Тег to open dropdown
    fireEvent.click(screen.getByText('+ Тег'));
    // Dropdown should show available tags (wait for async fetch)
    await waitFor(() => {
      expect(screen.getByText('Карандаш')).toBeInTheDocument();
    });
  });

  it('adds a tag when clicked in dropdown', async () => {
    const onChange = vi.fn();
    render(
      <TagsSelect
        selected={[]}
        fetchTags={vi.fn().mockResolvedValue(mockTags)}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('+ Тег'));
    await waitFor(() => {
      expect(screen.getByText('Масло')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Масло'));
    expect(onChange).toHaveBeenCalledWith([mockTags[0]]);
  });

  it('removes a tag when × is clicked', () => {
    const onChange = vi.fn();
    render(
      <TagsSelect
        selected={[mockTags[0], mockTags[1]]}
        fetchTags={vi.fn().mockResolvedValue(mockTags)}
        onChange={onChange}
      />,
    );
    // Find × button for "Масло"
    const removeBtn = screen.getByLabelText('Удалить тег Масло');
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith([mockTags[1]]);
  });

  it('hides already selected tags from dropdown', async () => {
    render(
      <TagsSelect
        selected={[mockTags[0]]}
        fetchTags={vi.fn().mockResolvedValue(mockTags)}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('+ Тег'));
    // Wait for tags to load
    await waitFor(() => {
      expect(screen.getByText('Акварель')).toBeInTheDocument();
    });
    // "Масло" should NOT appear in dropdown (it's already selected)
    const dropdown = screen.getByText('Акварель').parentElement;
    expect(dropdown?.querySelectorAll('button')).toHaveLength(2); // Акварель, Карандаш
  });

  it('shows "Нет тегов" when no tags available', async () => {
    render(
      <TagsSelect
        selected={[]}
        fetchTags={vi.fn().mockResolvedValue([])}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('+ Тег'));
    await waitFor(() => {
      expect(screen.getByText('Нет тегов')).toBeInTheDocument();
    });
  });
});
