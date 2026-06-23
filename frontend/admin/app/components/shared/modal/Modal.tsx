'use client';

import { ReactNode } from 'react';
import { MODAL_CONTAINER_CLASS, MODAL_MAX_WIDTH, MODAL_SMALL_CLASS, MODAL_SMALL_MAX_WIDTH } from './constants';

export interface ModalProps {
  /** Modal title shown in header. Pass null/empty for a blank header (still has border + height). */
  title?: ReactNode;
  /** Optional subtitle/context line shown next to title in smaller text. */
  context?: ReactNode;
  /** Body content. Required. */
  children: ReactNode;
  /** Optional footer content. Pass null/undefined to hide footer entirely. */
  footer?: ReactNode;
  /** Max-width Tailwind class. Defaults to 'max-w-2xl' (or 'max-w-lg' when size='small'). */
  maxWidthClass?: string;
  /** Close handler. If not provided, close button is hidden. */
  onClose?: () => void;
  /** Test ID for the modal container. */
  testId?: string;
  /** Whether to render a footer separator (border-t). Default true when footer is present. */
  footerBorder?: boolean;
  /** Modal size preset. 'small' uses h-[60vh] + max-w-lg. Default uses h-[85vh] + max-w-2xl. */
  size?: 'default' | 'small';
}

export function Modal({
  title,
  context,
  children,
  footer,
  maxWidthClass,
  onClose,
  testId = 'modal-container',
  footerBorder = true,
  size = 'default',
}: ModalProps) {
  const containerClass = size === 'small' ? MODAL_SMALL_CLASS : MODAL_CONTAINER_CLASS;
  const defaultMaxWidth = size === 'small' ? MODAL_SMALL_MAX_WIDTH : MODAL_MAX_WIDTH;

  return (
    <div
      data-testid={testId}
      className={`relative bg-white rounded-xl shadow-2xl w-full ${maxWidthClass ?? defaultMaxWidth} mx-4 ${containerClass}`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {title !== null && title !== undefined && title !== false && (
            <h2 className="text-sm font-semibold text-ink truncate">{title}</h2>
          )}
          {context && <span className="text-xs text-ink-light shrink-0">{context}</span>}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="text-ink-light hover:text-ink-mid text-xl leading-none shrink-0 ml-2"
            data-testid="modal-close-btn"
          >
            ×
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {children}
      </div>

      {/* Footer */}
      {footer !== null && footer !== undefined && (
        <div
          className={`px-5 py-3 shrink-0 ${footerBorder ? 'border-t' : ''}`}
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
