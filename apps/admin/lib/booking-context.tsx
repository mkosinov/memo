'use client';

import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { Activity, Client, Visitor } from '@memo/domain';
import { getStaticEvents, VISITORS, RECORDS, VISITS } from './mock-data';
import { addDays, getMondayStr } from './utils';

export interface BookingVisitor {
  tempId: string;
  name: string;
  age: number | '';
  isAdult: boolean;
  isPrimary: boolean;
  visitorId: string | null;
  priceCharged: number;
}

export type BookingStep = 1 | 2 | 3 | 4;
export type PaymentMethod = 'cash' | 'card' | 'transfer';

interface BookingContextType {
  step: BookingStep;
  setStep: (step: BookingStep) => void;
  selectedLocationId: string | null;
  setSelectedLocationId: (id: string | null) => void;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  weekStart: string;
  setWeekStart: (date: string) => void;
  selectedActivity: Activity | null;
  setSelectedActivity: (activity: Activity | null) => void;
  visitors: BookingVisitor[];
  addVisitor: (visitor: BookingVisitor) => void;
  removeVisitor: (tempId: string) => void;
  updateVisitor: (tempId: string, updates: Partial<BookingVisitor>) => void;
  comment: string;
  setComment: (comment: string) => void;
  paymentMethod: PaymentMethod | null;
  setPaymentMethod: (method: PaymentMethod | null) => void;
  isConfirmed: boolean;
  setIsConfirmed: (confirmed: boolean) => void;
  foundClient: Client | null;
  setFoundClient: (client: Client | null) => void;
  clientVisitors: Visitor[];
  totalPrice: number;
  availableActivities: Activity[];
  weekDays: string[];
  goNext: () => void;
  goBack: () => void;
  reset: () => void;
  getBookedCount: (activityId: string) => number;
}

const BookingContext = createContext<BookingContextType | null>(null);

export function useBooking() {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error('useBooking must be used within BookingProvider');
  return ctx;
}

const today = new Date().toISOString().split('T')[0];

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<BookingStep>(1);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [weekStart, setWeekStart] = useState<string>(getMondayStr(new Date()));
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [visitors, setVisitors] = useState<BookingVisitor[]>([]);
  const [comment, setComment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [foundClient, setFoundClient] = useState<Client | null>(null);

  const clientVisitors = useMemo(() => {
    if (!foundClient) return [];
    return VISITORS.filter(v => v.clientId === foundClient.id);
  }, [foundClient]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const availableActivities = useMemo(() => {
    return getStaticEvents().filter(a => {
      if (!selectedLocationId) return false;
      if (a.locationId !== selectedLocationId) return false;
      if (a.date !== selectedDate) return false;
      if (!a.isPublic) return false;
      return true;
    });
  }, [selectedLocationId, selectedDate]);

  const getBookedCount = useCallback((activityId: string) => {
    const confirmedRecords = RECORDS.filter(
      r => r.activityId === activityId && (r.status === 'WAITING' || r.status === 'VISITED')
    );
    return confirmedRecords.reduce((sum, r) => {
      return sum + VISITS.filter(v => v.recordId === r.id).length;
    }, 0);
  }, []);

  const totalPrice = useMemo(() => {
    return visitors.reduce((sum, v) => sum + v.priceCharged, 0);
  }, [visitors]);

  const addVisitor = useCallback((visitor: BookingVisitor) => {
    setVisitors(prev => [...prev, visitor]);
  }, []);

  const removeVisitor = useCallback((tempId: string) => {
    setVisitors(prev => prev.filter(v => v.tempId !== tempId));
  }, []);

  const updateVisitor = useCallback((tempId: string, updates: Partial<BookingVisitor>) => {
    setVisitors(prev => prev.map(v => v.tempId === tempId ? { ...v, ...updates } : v));
  }, []);

  const goNext = useCallback(() => {
    setStep(prev => Math.min(prev + 1, 4) as BookingStep);
  }, []);

  const goBack = useCallback(() => {
    setStep(prev => Math.max(prev - 1, 1) as BookingStep);
  }, []);

  const reset = useCallback(() => {
    setStep(1);
    setSelectedLocationId(null);
    setSelectedDate(today);
    setWeekStart(getMondayStr(new Date()));
    setSelectedActivity(null);
    setVisitors([]);
    setComment('');
    setPaymentMethod(null);
    setIsConfirmed(false);
    setFoundClient(null);
  }, []);

  return (
    <BookingContext.Provider value={{
      step, setStep,
      selectedLocationId, setSelectedLocationId,
      selectedDate, setSelectedDate,
      weekStart, setWeekStart,
      selectedActivity, setSelectedActivity,
      visitors, addVisitor, removeVisitor, updateVisitor,
      comment, setComment,
      paymentMethod, setPaymentMethod,
      isConfirmed, setIsConfirmed,
      foundClient, setFoundClient,
      clientVisitors,
      totalPrice,
      availableActivities,
      weekDays,
      goNext, goBack, reset,
      getBookedCount,
    }}>
      {children}
    </BookingContext.Provider>
  );
}
