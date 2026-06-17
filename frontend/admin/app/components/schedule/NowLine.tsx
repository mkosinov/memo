'use client';

import React, { useState, useEffect } from 'react';
import { HOURS_START } from '@/lib/utils';

interface NowLineProps {
  date: Date;
  cellHeight?: number;
  gridStart?: number;
}

export function NowLine({ date, cellHeight = 60, gridStart = HOURS_START }: NowLineProps) {
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const updatePosition = () => {
      const now = new Date();
      const hours = now.getHours() + now.getMinutes() / 60;
      const pos = (hours - gridStart) * cellHeight * 2;
      setPosition(pos);
    };

    updatePosition();
    const interval = setInterval(updatePosition, 30000);

    return () => clearInterval(interval);
  }, [cellHeight, gridStart]);

  const today = new Date();
  if (
    date.getDate() !== today.getDate() ||
    date.getMonth() !== today.getMonth() ||
    date.getFullYear() !== today.getFullYear()
  ) {
    return null;
  }

  if (position < 0) return null;

  return (
    <div
      data-testid="now-line"
      className="absolute left-0 right-0 z-[15] pointer-events-none"
      style={{ top: position }}
    >
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-brand" />
        <div className="flex-1 h-[2px] bg-brand" />
      </div>
    </div>
  );
}
