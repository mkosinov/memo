'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Activity, Artist, Service, Studio, StampState } from '../lib/types';
import { generateWeekEvents, ARTISTS, SERVICES, STUDIOS } from '../lib/mock-data';
import { getMonday } from '../lib/utils';

interface ScheduleContextType {
  activities: Activity[];
  artists: Artist[];
  services: Service[];
  studios: Studio[];
  currentWeek: Date;
  stamp: StampState;
  setCurrentWeek: (date: Date) => void;
  addActivity: (activity: Omit<Activity, 'id'>) => void;
  updateActivity: (id: string, updates: Partial<Activity>) => void;
  deleteActivity: (id: string) => void;
  setStamp: (stamp: StampState) => void;
  copyLastWeek: () => void;
}

const ScheduleContext = createContext<ScheduleContextType | null>(null);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const [currentWeek, setCurrentWeek] = useState(() => getMonday(new Date()));
  const [activities, setActivities] = useState<Activity[]>(() => generateWeekEvents(getMonday(new Date())));
  const [stamp, setStamp] = useState<StampState>({
    masterId: null,
    serviceId: null,
    locations: new Set(),
    ready: false,
  });

  const addActivity = useCallback((activity: Omit<Activity, 'id'>) => {
    const newActivity: Activity = {
      ...activity,
      id: `ev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
    setActivities(prev => [...prev, newActivity]);
  }, []);

  const updateActivity = useCallback((id: string, updates: Partial<Activity>) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const deleteActivity = useCallback((id: string) => {
    setActivities(prev => prev.filter(a => a.id !== id));
  }, []);

  const copyLastWeek = useCallback(() => {
    const lastWeek = new Date(currentWeek);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastWeekEvents = generateWeekEvents(lastWeek).filter(e => !e.isPrivate);
    const newEvents = lastWeekEvents.map(e => ({
      ...e,
      id: `ev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }));
    setActivities(prev => [...prev, ...newEvents]);
  }, [currentWeek]);

  return (
    <ScheduleContext.Provider value={{
      activities,
      artists: ARTISTS,
      services: SERVICES,
      studios: STUDIOS,
      currentWeek,
      stamp,
      setCurrentWeek,
      addActivity,
      updateActivity,
      deleteActivity,
      setStamp,
      copyLastWeek,
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) throw new Error('useSchedule must be used within ScheduleProvider');
  return context;
}
