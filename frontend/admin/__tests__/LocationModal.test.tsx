import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { LocationModal } from '../app/(main)/locations/components/LocationModal';
import { createMockLocationResponse } from './helpers/mockData';

/**
 * GH #601 Task 4 — «Видно клиентам» boolean field in the locations modal.
 *
 * Spec §2.6: the declarative `locationFields` config gains a `boolean`
 * type rendered as a `role="switch"` button (`data-testid="toggle-is-public"`,
 * donor: ActivityForm `toggle-private`). Direct binding — checked = is_public,
 * NO inversion. Available in BOTH create and edit. The boolean must survive
 * the modal mechanics as a boolean: create initializes it to `true` (not the
 * non-number empty string), and the submit payload carries it as a boolean
 * (a string would 422 the strict PUT schema).
 */

const PROPS = {
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

function renderModal(location: Record<string, unknown> | null, title: string) {
  return render(
    <LocationModal location={location} onSubmit={PROPS.onSubmit} onClose={PROPS.onClose} title={title} />,
  );
}

function switchEl(): HTMLElement {
  return screen.getByRole('switch');
}

/** Fill the required fields so validation lets «Сохранить» reach onSubmit.
 *  Placeholder/role-scoped: label text carries the required `*` marker, so
 *  getByLabelText('Название') misses (and substring matching would hit
 *  «Короткое название»). */
function fillRequired(title: string) {
  fireEvent.change(screen.getByPlaceholderText('Студия на Тверской'), { target: { value: title } });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6' } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('LocationModal — «Видно клиентам» switch (GH #601)', () => {
  it('create: renders the switch labelled «Видно клиентам», ON by default', () => {
    renderModal(null, 'Новая локация');
    const toggle = switchEl();
    expect(toggle).toHaveAttribute('data-testid', 'toggle-is-public');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Видно клиентам')).toBeInTheDocument();
  });

  it('create: default submit payload carries is_public=true as a boolean', async () => {
    renderModal(null, 'Новая локация');
    fillRequired('Созданная');
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(PROPS.onSubmit).toHaveBeenCalled());
    const payload = PROPS.onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.is_public).toBe(true);
    expect(typeof payload.is_public).toBe('boolean');
  });

  it('create: toggling off submits is_public=false as a boolean', async () => {
    renderModal(null, 'Новая локация');
    fillRequired('Скрытая при создании');
    fireEvent.click(switchEl());
    expect(switchEl()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(PROPS.onSubmit).toHaveBeenCalled());
    const payload = PROPS.onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.is_public).toBe(false);
    expect(typeof payload.is_public).toBe('boolean');
  });

  it('edit: reflects is_public=false from the location and submits false', async () => {
    renderModal(
      createMockLocationResponse({ title: 'Скрытая', is_public: false }),
      'Редактирование локации',
    );
    expect(switchEl()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(PROPS.onSubmit).toHaveBeenCalled());
    const payload = PROPS.onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.is_public).toBe(false);
    expect(typeof payload.is_public).toBe('boolean');
  });

  it('edit: toggling a visible location off submits is_public=false', async () => {
    renderModal(
      createMockLocationResponse({ title: 'Видимая', is_public: true }),
      'Редактирование локации',
    );
    expect(switchEl()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(switchEl());
    expect(switchEl()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByText('Сохранить'));
    await waitFor(() => expect(PROPS.onSubmit).toHaveBeenCalled());
    const payload = PROPS.onSubmit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.is_public).toBe(false);
  });
});
