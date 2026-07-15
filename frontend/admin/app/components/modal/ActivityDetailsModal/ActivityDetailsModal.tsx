'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useClients } from '@/contexts/ClientsContext';
import { useUI } from '@/contexts/UIContext';
import type { Activity } from '@memo/domain';
import { formatActivityContext, formatTime } from '@/lib/utils';
import { TabNav, type Tab } from './TabNav';
import { SettingsTab } from './SettingsTab';
import { ClientTab } from './ClientTab';
import { NewBookingTab } from './NewBookingTab';
import { Modal } from '@/app/components/shared/modal/Modal';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { parseApiError } from '@/app/lib/api/parseApiError';

interface ActivityDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activity: Activity;
  mode: 'edit' | 'quickAdd';
}

export function ActivityDetailsModal({ isOpen, onClose, activity, mode }: ActivityDetailsModalProps) {
  const { services, servicesRaw, updateActivity, deleteActivity } = useSchedule();
  const { records, clients } = useRecords();
  const { clients: clientsList } = useClients();
  const { showToast } = useUI();

  const [activeTab, setActiveTab] = useState(mode === 'quickAdd' ? 'new-booking' : 'settings');

  // Extract record ID from active tab (only for client tabs)
  const activeRecordId = activeTab.startsWith('client-')
    ? activeTab.replace('client-', '')
    : null;

  // Use the hook for record mutations (only when we have a record ID)
  const { createRecord, deleteRecord } = useRecordMutations(activity.id, activeRecordId || '');

  // Current service and its tariffs (used by all tab contents)
  const currentService = useMemo(
    () => services.find((s) => s.id === activity.serviceId),
    [services, activity.serviceId],
  );
  const currentRawService = useMemo(
    () => servicesRaw.find((s) => s.id === activity.serviceId),
    [servicesRaw, activity.serviceId],
  );
  const serviceTariffs = useMemo(
    () => currentRawService?.tariffs ?? [],
    [currentRawService],
  );

  // Get records for this activity
  const activityRecords = useMemo(
    () => records.filter((r) => r.activity_id === activity.id),
    [records, activity.id],
  );

  // Build a visitors map from records' visits (visitors are embedded in visits via visitor_id)
  // We need to look up visitor details from RecordsContext or we pass visits directly
  // (#127 Task 7: removed — ClientTab now reads visitors from useRecordData, not from props)

  // Build a map from useClients() (has stats) for O(1) lookup
  const clientsWithStats = useMemo(() => {
    const map = new Map(clientsList.map(c => [c.id, c]));
    return map;
  }, [clientsList]);

  // Build tabs: settings + client tabs
  const tabs: Tab[] = useMemo(() => {
    const settingsTab: Tab = { id: 'settings', label: 'Настройка' };
    const clientTabs: Tab[] = activityRecords.map((record) => {
    const client = clientsWithStats.get(record.client_id ?? '') ?? clients.get(record.client_id ?? '');
      const name = client?.name?.trim();
      const phone = client?.phone?.trim();
      const totalSeats = record.visits.length + (record.anonym_visits ?? 0);
      return {
        id: `client-${record.id}`,
        label: (
          <div className="flex items-start justify-between w-full min-w-0">
            <div className="flex flex-col min-w-0">
              <span className="truncate">{name || phone || 'Без контакта'}</span>
              {phone && <span className="text-xs text-ink-light truncate">{phone}</span>}
            </div>
            <div className="flex flex-col items-end shrink-0 ml-1">
              <span className="text-[10px] opacity-70">x{totalSeats}</span>
              {client && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                    window.open(`/clients?clientId=${client.id}`, '_blank', 'noopener,noreferrer');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onClose();
                      window.open(`/clients?clientId=${client.id}`, '_blank', 'noopener,noreferrer');
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
  }, [activityRecords, clients]);

  // Delete activity handler
  const handleDeleteActivity = useCallback(() => {
    deleteActivity(activity.id);
    showToast('Активность удалена');
    onClose();
  }, [activity.id, deleteActivity, showToast, onClose]);

  // Activity update callback for settings
  const handleActivityUpdate = useCallback(
    (updates: Partial<Activity>) => {
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

  // Delete record handler — uses the hook
  const handleDeleteRecord = useCallback(
    async (_recordId: string) => {
      try {
        await deleteRecord();
        showToast('Запись удалена');
        setActiveTab('settings');
      } catch (err) {
        showToast(parseApiError(err).message, 'error');
      }
    },
    [deleteRecord, showToast],
  );


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

    const client = clients.get(record.client_id ?? '');

    return (
      <ClientTab
        recordId={recordId}
        activityId={activity.id}
        clientId={record.client_id ?? ''}
        client={client}
        onDeleteRecord={handleDeleteRecord}
        onClose={onClose}
      />
    );
  };

  if (!isOpen) return null;

  // Activity context header label
  const contextLabel = activity.date
    ? formatActivityContext(new Date(activity.date + 'T' + formatTime(activity.startTime) + ':00'))
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
        title={activity.serviceName || 'Мероприятие'}
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
