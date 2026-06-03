'use client';

import React from 'react';

interface ModalFooterProps {
  totalCost: number;
  totalOwed: number;
}

function formatPrice(value: number): string {
  return value.toLocaleString('ru-RU') + ' ₽';
}

export function ModalFooter({ totalCost, totalOwed }: ModalFooterProps) {
  return (
    <div
      data-testid="modal-footer"
      className="flex items-center justify-between px-5 py-3 border-t text-sm"
      style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
    >
      <span className="text-ink-mid">
        Стоимость: <span className="font-semibold text-ink" data-testid="total-cost">{formatPrice(totalCost)}</span>
      </span>
      <span className="text-ink-mid">
        К оплате:{' '}
        <span
          className="font-semibold"
          style={{ color: totalOwed > 0 ? 'var(--danger, #C8503C)' : 'var(--success, #6B8E6E)' }}
          data-testid="total-owed"
        >
          {formatPrice(totalOwed)}
        </span>
      </span>
    </div>
  );
}
