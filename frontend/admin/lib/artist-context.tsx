'use client';

import React, { createContext, useContext, useState, useMemo } from 'react';
import { Activity, Artist } from '@memo/domain';
import { ARTISTS, INITIAL_ACTIVITIES, RECORDS, VISITS, VISITORS, PAYMENTS, SERVICES, LOCATIONS, addDays, getMonday } from './mock-data';

export interface AvailabilitySlot {
  day: string;
  hour: number;
  available: boolean;
}

interface ArtistContextType {
  selectedArtistId: string;
  setSelectedArtistId: (id: string) => void;
  weekStart: string;
  setWeekStart: (d: string) => void;
  weekDays: string[];
  expandedActivityId: string | null;
  setExpandedActivityId: (id: string | null) => void;
  isOffline: boolean;
  setIsOffline: (v: boolean) => void;
  availability: AvailabilitySlot[];
  toggleAvailability: (day: string, hour: number) => void;
  artistActivities: Activity[];
  selectedArtist: Artist | undefined;
  getVisitorsForActivity: (activityId: string) => VisitorInfo[];
  getPaymentStatus: (recordId: string) => 'paid' | 'unpaid' | 'partial';
}

export interface VisitorInfo {
  name: string;
  age?: number;
  isAdult: boolean;
  isPrimary: boolean;
  priceCharged: number;
}

const ArtistContext = createContext<ArtistContextType | null>(null);

export function useArtist() {
  const ctx = useContext(ArtistContext);
  if (!ctx) throw new Error('useArtist must be used within ArtistProvider');
  return ctx;
}

export function ArtistProvider({ children }: { children: React.ReactNode }) {
  const [selectedArtistId, setSelectedArtistId] = useState(ARTISTS[0].id);
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(true);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>(() => {
    const slots: AvailabilitySlot[] = [];
    const ws = getMonday(new Date());
    for (let d = 0; d < 7; d++) {
      for (let h = 9; h <= 20; h++) {
        slots.push({ day: addDays(ws, d), hour: h, available: true });
      }
    }
    return slots;
  });

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const selectedArtist = useMemo(() => ARTISTS.find(a => a.id === selectedArtistId), [selectedArtistId]);

  const artistActivities = useMemo(() =>
    INITIAL_ACTIVITIES.filter(a => a.artistId === selectedArtistId && weekDays.includes(a.date)),
    [selectedArtistId, weekDays]
  );

  const toggleAvailability = (day: string, hour: number) => {
    setAvailability(prev => prev.map(s =>
      s.day === day && s.hour === hour ? { ...s, available: !s.available } : s
    ));
  };

  const getVisitorsForActivity = (activityId: string): VisitorInfo[] => {
    const records = RECORDS.filter(r => r.activityId === activityId && r.status !== 'CANCELLED');
    const result: VisitorInfo[] = [];
    for (const record of records) {
      const visits = VISITS.filter(v => v.recordId === record.id);
      for (const visit of visits) {
        const visitor = VISITORS.find(vi => vi.id === visit.visitorId);
        if (visitor) {
          result.push({
            name: visitor.name,
            age: visitor.age,
            isAdult: visitor.isAdult,
            isPrimary: visit.isPrimary,
            priceCharged: visit.priceCharged,
          });
        }
      }
    }
    return result;
  };

  const getPaymentStatus = (recordId: string): 'paid' | 'unpaid' | 'partial' => {
    const recPayments = PAYMENTS.filter(p => p.recordId === recordId);
    if (recPayments.length === 0) return 'unpaid';
    const allPaid = recPayments.every(p => p.paid);
    return allPaid ? 'paid' : 'partial';
  };

  return (
    <ArtistContext.Provider value={{
      selectedArtistId,
      setSelectedArtistId,
      weekStart,
      setWeekStart,
      weekDays,
      expandedActivityId,
      setExpandedActivityId,
      isOffline,
      setIsOffline,
      availability,
      toggleAvailability,
      artistActivities,
      selectedArtist,
      getVisitorsForActivity,
      getPaymentStatus,
    }}>
      {children}
    </ArtistContext.Provider>
  );
}