'use client';

import React, { useState, useEffect } from 'react';

interface NowLineProps {
  date: Date;
  cellHeight?: number;
  /** Grid start in minutes from midnight (GH #142). */
  gridStartMinutes?: number;
}

export function NowLine({ date, cellHeight = 60, gridStartMinutes = 540 }: NowLineProps) {
  const [position, setPosition] = useState(0);

  useEffect(() => {
    const updatePosition = () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const pos = (nowMinutes - gridStartMinutes) * cellHeight / 30;
      setPosition(pos);
    };

    updatePosition();
    const interval = setInterval(updatePosition, 30000);

    return () => clearInterval(interval);
  }, [cellHeight, gridStartMinutes]);

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
