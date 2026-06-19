'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useSchedule } from '@/contexts/ScheduleContext';
import { useRecords } from '@/contexts/RecordsContext';
import { useUI } from '@/contexts/UIContext';
import type { Activity, Service } from '@memo/domain';
import { formatActivityContext } from '@/lib/utils';
import { TabNav, type Tab } from './TabNav';
import { SettingsTab } from './SettingsTab';
import { ClientTab } from './ClientTab';
import { NewBookingTab } from './NewBookingTab';
import { ModalFooter } from './ModalFooter';
import type { TariffResponse } from '@memo/api-client';
import { useRecordMutations } from '@/hooks/useRecordMutations';

interface ActivityDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activity: Activity;
  mode: 'edit' | 'quickAdd';
}

/** Get tariffs from a service (if the API response includes them). */
function getServiceTariffs(service: Service | undefined): TariffResponse[] {
  if (!service) return [];
  const svc = service as Service & { tariffs?: TariffResponse[] };
  return svc.tariffs || [];
}

export function ActivityDetailsModal({ isOpen, onClose, activity, mode }: ActivityDetailsModalProps) {
  const { services, updateActivity } = useSchedule();
  const { records, clients, payments } = useRecords();
  const { showToast } = useUI();

  const [activeTab, setActiveTab] = useState(mode === 'quickAdd' ? 'new-booking' : 'settings');

  // Extract record ID from active tab (only for client tabs)
  const activeRecordId = activeTab.startsWith('client-')
    ? activeTab.replace('client-', '')
    : null;

  // Use the hook for record mutations (only when we have a record ID)
  const { createRecord, deleteRecord, addPayment, deletePayment, addVisitorToRecord } = useRecordMutations(activity.id, activeRecordId || '');

  // Current service and its tariffs (used by all tab contents)
  const currentService = useMemo(
    () => services.find((s) => s.id === activity.serviceId),
    [services, activity.serviceId],
  );
  const serviceTariffs = useMemo(() => getServiceTariffs(currentService), [currentService]);

  // Get records for this activity
  const activityRecords = useMemo(
    () => records.filter((r) => r.activity_id === activity.id),
    [records, activity.id],
  );

  // Build a visitors map from records' visits (visitors are embedded in visits via visitor_id)
  // We need to look up visitor details from RecordsContext or we pass visits directly
  const visitorsByRecord = useMemo(() => {
    // Since visitors are not stored separately in RecordsContext,
    // we derive them from visits embedded in records
    const map = new Map<string, Array<{ id: string; name: string; age: number | null }>>();
    for (const record of activityRecords) {
      // Visits contain visitor_id, but we need actual visitor objects.
      // For now, we create lightweight visitor objects from visit data.
      map.set(
        record.id,
        record.visits.map((v) => ({
          id: v.visitor_id,
          name: '', // Will be resolved by ClientTab if needed
          age: null,
        })),
      );
    }
    return map;
  }, [activityRecords]);

  // Build tabs: settings + client tabs
  const tabs: Tab[] = useMemo(() => {
    const settingsTab: Tab = { id: 'settings', label: 'Настройка' };
    const clientTabs: Tab[] = activityRecords.map((record) => {
      const client = clients.get(record.client_id ?? '');
      return {
        id: `client-${record.id}`,
        label: client?.name || 'Неизвестный',
        sublabel: client?.phone || '',
      };
    });
    return [settingsTab, ...clientTabs];
  }, [activityRecords, clients]);

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
      } catch {
        showToast('Ошибка создания записи');
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
      } catch {
        showToast('Ошибка удаления');
      }
    },
    [deleteRecord, showToast],
  );

  // Payment handler — uses the hook
  const handleAddPayment = useCallback(
    async (_recordId: string, amount: number, method: string) => {
      try {
        await addPayment(amount, method);
        showToast(`Оплата ${amount} ₽ (${method}) добавлена`);
      } catch {
        showToast('Ошибка добавления оплаты');
      }
    },
    [addPayment, showToast],
  );

  // Financial summary
  const totalCost = useMemo(
    () =>
      activityRecords.reduce(
        (sum, record) => sum + record.visits.reduce((vSum, v) => vSum + v.price, 0),
        0,
      ),
    [activityRecords],
  );

  const totalPaid = useMemo(
    () =>
      activityRecords.reduce((sum, record) => {
        const rp = payments.get(record.id) || [];
        return sum + rp.reduce((pSum, p) => pSum + p.amount, 0);
      }, 0),
    [activityRecords, payments],
  );

  const totalOwed = totalCost - totalPaid;

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
    const recordPayments = payments.get(record.id) || [];
    const recordVisitors = visitorsByRecord.get(record.id) || [];

    return (
      <ClientTab
        record={record}
        client={client}
        visitors={recordVisitors as any}
        visits={record.visits}
        payments={recordPayments}
        serviceTariffs={serviceTariffs}
        onUpdateRecord={() => {}}
        onDeleteRecord={handleDeleteRecord}
        onAddPayment={handleAddPayment}
        onDeletePayment={(id) => deletePayment(id)}
        onAddVisitor={async (data) => {
          try {
            const firstPrice = serviceTariffs[0]?.price ?? 0;
            await addVisitorToRecord({ ...data, price: firstPrice });
            showToast('Посетитель добавлен');
          } catch {
            showToast('Ошибка добавления посетителя');
          }
        }}
        showToast={showToast}
        onClose={onClose}
      />
    );
  };

  if (!isOpen) return null;

  // Activity context header label
  const contextLabel = activity.date
    ? formatActivityContext(new Date(activity.date + 'T12:00:00'))
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" data-testid="activity-details-modal">
      {/* Backdrop */}
      <div
        data-testid="details-modal-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: '85vh' }}
      >
        {/* Context header */}
        <div
          data-testid="activity-context"
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold text-ink truncate">
              {activity.serviceName || 'Мероприятие'}
            </h2>
            {contextLabel && (
              <span className="text-xs text-ink-light shrink-0">{contextLabel}</span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="text-ink-light hover:text-ink-mid text-xl leading-none shrink-0 ml-2"
            data-testid="modal-close-btn"
          >
            ×
          </button>
        </div>

        {/* Body: TabNav + Content */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          <TabNav
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onAddClick={handleAddClick}
          />
          <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--white)' }}>
            {renderContent()}
          </div>
        </div>

        {/* Footer */}
        <ModalFooter totalCost={totalCost} totalOwed={totalOwed} />
      </div>
    </div>
  );
}
