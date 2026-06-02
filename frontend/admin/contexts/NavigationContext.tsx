'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { getMonday, formatDateISO } from '@/lib/utils';

interface NavigationContextType {
  dateFrom: string;
  dateTo: string;
  selectDateRange: (from: string, to: string) => void;
}

const NavigationContext = createContext<NavigationContextType | null>(null);

function getCurrentWeekRange(): { dateFrom: string; dateTo: string } {
  const monday = getMonday(new Date());
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return {
    dateFrom: formatDateISO(monday),
    dateTo: formatDateISO(sunday),
  };
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [dateFrom, setDateFrom] = useState(getCurrentWeekRange().dateFrom);
  const [dateTo, setDateTo] = useState(getCurrentWeekRange().dateTo);

  const selectDateRange = useCallback((from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  }, []);

  return (
    <NavigationContext.Provider value={{ dateFrom, dateTo, selectDateRange }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextType {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}
