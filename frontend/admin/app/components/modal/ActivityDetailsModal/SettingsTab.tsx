'use client';

import { useState, useEffect, useCallback } from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useGridSettings } from '@/contexts/schedule/GridSettingsContext';
import { ActivityForm } from './ActivityForm';
import type { ScheduleAdminDTO } from '@memo/domain';
import { formatTime, hhmmToMinutes, composeLocalISO, snapMinutes, buildDateTimeLocal } from '@/lib/datetime';

/** Update payload accepted by ScheduleDataContext.updateActivity (GH #142 minutes contract). */
type ActivityUpdates = Parameters<ReturnType<typeof useScheduleData>['updateActivity']>[1];

interface SettingsTabProps {
  activity: ScheduleAdminDTO;
  onUpdate: (updates: ActivityUpdates) => void;
}

/**
 * Edit-mode wiring of the shared ActivityForm (GH #280): every change is an
 * instant patch via onUpdate (values snap to the activity prop on external
 * resync). All markup lives in ActivityForm.
 */
export function SettingsTab({ activity, onUpdate }: SettingsTabProps) {
  const { masters, services, locations } = useScheduleData();
  const { gridFrequency } = useGridSettings();

  const [serviceId, setServiceId] = useState(activity.serviceId);
  const [masterId, setMasterId] = useState(activity.masterId);
  const [locationId, setLocationId] = useState(activity.locationId);
  const [capacity, setCapacity] = useState(activity.capacity);
  const [durationStr, setDurationStr] = useState(formatTime(activity.durationMinutes));
  const [isPrivate, setIsPrivate] = useState(activity.isPrivate);
  const [startDateTime, setStartDateTime] = useState(() => {
    return buildDateTimeLocal(activity.date || '', activity.startMinutes, gridFrequency);
  });

  // Auto-fill from service when service changes
  const handleServiceChange = useCallback(
    (newServiceId: string) => {
      setServiceId(newServiceId);
      const svc = services.find((s) => s.id === newServiceId);
      if (svc) {
        setDurationStr(formatTime(svc.durationMinutes));
        onUpdate({
          serviceId: newServiceId,
          durationMinutes: svc.durationMinutes,
        });
      }
    },
    [services, onUpdate],
  );

  // Handle datetime change
  const handleDateTimeChange = useCallback(
    (value: string) => {
      if (value) {
        const [datePart, timePart] = value.split('T');
        const rawMinutes = hhmmToMinutes(timePart);
        const snappedMinutes = snapMinutes(rawMinutes, gridFrequency);
        // Rebuild snapped datetime-local value for display
        setStartDateTime(composeLocalISO(datePart, snappedMinutes).slice(0, 16));
        // Calculate day from date
        const date = new Date(datePart + 'T12:00:00');
        const dayOfWeek = (date.getDay() + 6) % 7; // Mon=0
        onUpdate({ startMinutes: snappedMinutes, dayIndex: dayOfWeek });
      }
    },
    [onUpdate, gridFrequency],
  );

  // Handle duration change
  const handleDurationChange = useCallback(
    (value: string) => {
      setDurationStr(value);
      const minutes = hhmmToMinutes(value);
      if (!isNaN(minutes) && minutes > 0) {
        onUpdate({ durationMinutes: minutes });
      }
    },
    [onUpdate],
  );

  // Handle capacity change (GH #280: вместимость ≥ 1) — instant-patch
  // convention like the «ЧЧ:ММ» duration: the field follows the raw input,
  // but empty/zero values are silently not applied (no patch fires).
  const handleCapacityChange = useCallback(
    (value: string) => {
      const val = Number(value);
      setCapacity(val);
      if (val >= 1) {
        onUpdate({ capacity: val });
      }
    },
    [onUpdate],
  );

  // Sync state from activity prop changes (e.g. after DnD)
  useEffect(() => {
    setServiceId(activity.serviceId);
    setMasterId(activity.masterId);
    setLocationId(activity.locationId);
    setCapacity(activity.capacity);
    setDurationStr(formatTime(activity.durationMinutes));
    setIsPrivate(activity.isPrivate);

    setStartDateTime(
      buildDateTimeLocal(activity.date || '', activity.startMinutes, gridFrequency),
    );
    // `activity` is the ONLY resync trigger by design: the local editable
    // state must reset when the activity prop changes (DnD, external edit),
    // while a mid-edit gridFrequency change (settings modal elsewhere) must
    // NOT clobber fields the admin is typing. Adding gridFrequency would
    // re-run the whole reset on an unrelated context switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gridFrequency is display-snapping only; resync fires on activity changes alone (see above)
  }, [activity]);

  return (
    <ActivityForm
      containerTestId="settings-tab"
      services={services}
      masters={masters}
      locations={locations}
      values={{
        startDateTime,
        durationStr,
        isPrivate,
        serviceId,
        capacity,
        masterId,
        locationId,
      }}
      onDateTimeChange={handleDateTimeChange}
      onDurationChange={handleDurationChange}
      onPrivateToggle={() => {
        setIsPrivate(!isPrivate);
        onUpdate({ isPrivate: !isPrivate });
      }}
      onServiceChange={handleServiceChange}
      onCapacityChange={handleCapacityChange}
      onMasterChange={(value) => {
        setMasterId(value);
        onUpdate({ masterId: value });
      }}
      onLocationChange={(v) => {
        setLocationId(v);
        onUpdate({ locationId: v });
      }}
    />
  );
}
