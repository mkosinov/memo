/**
 * Modal shell layout — GH #262 visual-gate fix.
 *
 * The shell previously used a FIXED height (h-[85vh] default / h-[60vh]
 * small). Two defects:
 *  1. A short form (PasswordModal, 3 fields) was stretched to 60vh with
 *     ~165px of dead whitespace above the footer;
 *  2. Combined with `overflow-hidden` on the body wrapper, tall content
 *     (MyDataModal anonymous variant) clipped the last field.
 *
 * Now the shell sizes to its CONTENT up to a max cap (max-h-*), and the
 * body wrapper never clips what a scrollable child can reveal.
 *
 * GH #598: an opt-in `heightClass` prop lets a consumer pin a fixed height
 * (activity modal: h-[85dvh]) ON TOP of the unchanged base cap. The default
 * stays content-sized — the lock regex below forbids vh AND dvh fixed
 * classes, keeping the (?:^|\s) anchor so the `h-[85vh]` inside the base
 * `max-h-[85vh]` cap is not a false match.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { Modal } from '@/app/components/shared/modal/Modal';
import {
  MODAL_CONTAINER_CLASS,
  MODAL_SMALL_CLASS,
} from '@/app/components/shared/modal/constants';

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  return render(
    <Modal title="Т" onClose={vi.fn()} footer={<button>Сохранить</button>} {...props}>
      <div>body</div>
    </Modal>,
  );
}

describe('Modal shell — natural height with max cap (GH #262)', () => {
  it('default size caps height instead of fixing it (content can be shorter)', () => {
    renderModal();
    const shell = screen.getByTestId('modal-container');
    expect(shell.className).toContain('max-h-');
    // no FIXED height (h-[Nvh] / h-[Ndvh]) — only the max cap (max-h-[85vh])
    expect(shell.className).not.toMatch(/(?:^|\s)h-\[\d+(d)?vh\]/);
    expect(MODAL_CONTAINER_CLASS).toContain('max-h-[85vh]');
    expect(MODAL_CONTAINER_CLASS).not.toMatch(/(?:^|\s)h-\[\d+(d)?vh\]/);
  });

  it('small size caps height instead of fixing it (no stretched password form)', () => {
    renderModal({ size: 'small' });
    const shell = screen.getByTestId('modal-container');
    expect(shell.className).toContain('max-h-');
    expect(shell.className).not.toMatch(/(?:^|\s)h-\[\d+(d)?vh\]/);
    expect(MODAL_SMALL_CLASS).toContain('max-h-[60vh]');
    expect(MODAL_SMALL_CLASS).not.toMatch(/(?:^|\s)h-\[\d+(d)?vh\]/);
  });

  it('body wrapper keeps min-h-0 so a flex child can scroll, not clip', () => {
    renderModal();
    const body = screen.getByText('body').parentElement!;
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('flex-1');
  });

  it('footer stays outside the scroll region (always visible, shrink-0)', () => {
    renderModal();
    const footer = screen.getByText('Сохранить').closest('div.shrink-0');
    expect(footer).not.toBeNull();
    // the footer is a sibling of the body wrapper, not inside it
    const body = screen.getByText('body').parentElement!;
    expect(footer!.contains(body)).toBe(false);
    expect(body.contains(footer!)).toBe(false);
  });
});

describe('Modal shell — opt-in fixed height via heightClass (GH #598)', () => {
  it('heightClass puts the passed fixed-height class on the container', () => {
    renderModal({ heightClass: 'h-[85dvh]' });
    const shell = screen.getByTestId('modal-container');
    // anchored match: a standalone class, not a substring of another utility
    expect(shell.className).toMatch(/(?:^|\s)h-\[85dvh\]/);
  });

  it('the fixed class SUPPLEMENTS the base cap — max-h-[85vh] stays', () => {
    renderModal({ heightClass: 'h-[85dvh]' });
    const shell = screen.getByTestId('modal-container');
    expect(shell.className).toContain('max-h-[85vh]');
  });
});
