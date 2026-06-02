import React from 'react';

interface DiamondIconProps {
  className?: string;
  size?: number;
  color?: string;
}

export function DiamondIcon({ className, size = 14, color = 'var(--danger)' }: DiamondIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      className={className}
      aria-label="Индивидуальное занятие"
    >
      <path d="M12 2L2 12l10 10 10-10L12 2z" />
    </svg>
  );
}
