'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useUI } from '@/contexts/UIContext';
import type { ScheduleAdminDTO } from '@memo/domain';
import { formatActivityContext } from '@/lib/utils';
import { TabNav, type Tab } from './TabNav';
import { SettingsTab } from './SettingsTab';
import { ClientTab } from './ClientTab';
import { ClientLabelById } from './ClientLabelById';
import { NewBookingTab } from './NewBookingTab';
import { Modal } from '@/app/components/shared/modal/Modal';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { useActivityRecords } from '@/hooks/useActivities';
import { parseApiError } from '@/app/lib/api/parseApiError';

interface ActivityDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activity: ScheduleAdminDTO;
  mode: 'edit' | 'quickAdd';
}

export function ActivityDetailsModal({ isOpen, onClose, activity, mode }: ActivityDetailsModalProps) {
  const { services, updateActivity, deleteActivity } = useSchedule();
  const { showToast } = useUI();

  const [activeTab, setActiveTab] = useState(mode === 'quickAdd' ? 'new-booking' : 'settings');

  // Extract record ID from active tab (only for client tabs)
  const activeRecordId = activeTab.startsWith('client-')
    ? activeTab.replace('client-', '')
    : null;

  // Hook for record mutations (only when we have a record ID). Deletion is
  // NOT here — Addendum 13: ClientTab owns the record delete via the shared
  // useDeleteRecord hook + DeleteDialog and reports back via onDeleteRecord.
  const { createRecord } = useRecordMutations(activity.id, activeRecordId || '');

  // Tariffs of the activity's service — domain Service carries them (GH #142).
  const serviceTariffs = useMemo(
    () => services.find((s) => s.id === activity.serviceId)?.tariffs ?? [],
    [services, activity.serviceId],
  );

  // Own data — context records is now one server page; activity bookings need
  // the full set (#191). GH #140: point hook on ['records','activity',id].
  const { data: activityRecords = [] } = useActivityRecords(activity.id, isOpen);

  // GH #140 US-2: each record tab resolves its OWN client via useClient (inside
  // ClientLabelById) — no clients-list dependency. Every tab (not just the
  // active one) shows the resolved name+phone; shared ['client', id] dedupes
  // across tabs of the same client and with ClientQuickCard.
  const tabs: Tab[] = useMemo(() => {
    const settingsTab: Tab = { id: 'settings', label: 'Настройка' };
    const clientTabs: Tab[] = activityRecords.map((record) => {
      const totalSeats = record.visits.length + (record.anonym_visits ?? 0);
      return {
        id: `client-${record.id}`,
        label: (
          <div className="flex items-start justify-between w-full min-w-0">
            <ClientLabelById clientId={record.client_id ?? undefined} />
            <div className="flex flex-col items-end shrink-0 ml-1">
              <span className="text-[10px] opacity-70">x{totalSeats}</span>
              {record.client_id && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                    window.open(`/clients?clientId=${record.client_id}`, '_blank', 'noopener,noreferrer');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onClose();
                      window.open(`/clients?clientId=${record.client_id}`, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className="cursor-pointer hover:opacity-100 inline-flex"
                  title="Открыть профиль"
                  data-testid={`open-profile-${record.id}`}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </span>
              )}
            </div>
          </div>
        ),
      };
    });
    return [settingsTab, ...clientTabs];
  }, [activityRecords, onClose]);

  // Delete activity handler
  const handleDeleteActivity = useCallback(() => {
    deleteActivity(activity.id);
    showToast('Активность удалена');
    onClose();
  }, [activity.id, deleteActivity, showToast, onClose]);

  // Activity update callback for settings — payload is the context's
  // minutes-based update shape (GH #142).
  const handleActivityUpdate = useCallback(
    (updates: Parameters<typeof updateActivity>[1]) => {
      updateActivity(activity.id, updates);
    },
    [activity.id, updateActivity],
  );

  // Switch to new booking tab
  const handleAddClick = useCallback(() => {
    setActiveTab('new-booking');
  }, []);

  // New booking submit handler — delegates to useRecordMutations hook
  const handleNewBookingSubmit = useCallback(
    async (data: {
      phone: string;
      name: string;
      visitors: Array<{ name: string; age?: string; tariffId: string }>;
      notify: boolean;
      channel: string;
      seats: number;
    }) => {
      try {
        await createRecord(data, serviceTariffs);
        showToast('Запись создана');
        setActiveTab('settings');
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
      }
    },
    [createRecord, serviceTariffs, showToast],
  );

  // Delete record handler — ClientTab owns the Addendum 13 dry-run flow
  // (shared useDeleteRecord hook + DeleteDialog) and calls back here AFTER a
  // successful delete (hook already toasted «Запись удалена»). Keep today's
  // post-delete navigation only — no second delete.
  const handleDeleteRecord = useCallback((_recordId: string) => {
    setActiveTab('settings');
  }, []);


  // Content renderer per active tab
  const renderContent = () => {
    if (activeTab === 'new-booking') {
      return (
        <NewBookingTab
          activity={activity}
          serviceTariffs={serviceTariffs}
          onSubmit={handleNewBookingSubmit}
          showToast={showToast}
        />
      );
    }

    if (activeTab === 'settings') {
      return <SettingsTab activity={activity} onUpdate={handleActivityUpdate} />;
    }

    // Client tab
    const recordId = activeTab.replace('client-', '');
    const record = activityRecords.find((r) => r.id === recordId);
    if (!record) return null;

    // GH #140 US-2: ClientTab owns its client resolution via useClient —
    // no client prop from a clients-list map.
    return (
      <ClientTab
        recordId={recordId}
        activityId={activity.id}
        clientId={record.client_id ?? ''}
        onDeleteRecord={handleDeleteRecord}
        onClose={onClose}
      />
    );
  };

  if (!isOpen) return null;

  // Activity context header label — DTO carries date + time display caches.
  const contextLabel = activity.date
    ? formatActivityContext(new Date(activity.date + 'T' + activity.time + ':00'))
    : '';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" role="dialog" aria-modal="true" data-testid="activity-details-modal">
      {/* Backdrop */}
      <div
        data-testid="details-modal-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <Modal
        title={activity.serviceTitle || 'Мероприятие'}
        context={contextLabel}
        onClose={onClose}
        footer={
          <div data-testid="modal-footer">
            <button
              onClick={handleDeleteActivity}
              className="text-red-500 hover:text-red-600 transition-colors text-sm"
              data-testid="btn-delete-activity"
            >
              Удалить активность
            </button>
          </div>
        }
        testId="activity-details-modal-container"
      >
        <TabNav
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onAddClick={handleAddClick}
        />
        <div className="flex-1 flex flex-col overflow-y-auto" style={{ backgroundColor: 'var(--white)' }}>
          {renderContent()}
        </div>
      </Modal>
    </div>
  );
}
