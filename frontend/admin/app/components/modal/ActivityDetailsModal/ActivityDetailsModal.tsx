'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useScheduleData } from '@/contexts/schedule/ScheduleDataContext';
import { useUI } from '@/contexts/UIContext';
import type { ScheduleAdminDTO } from '@memo/domain';
import { formatActivityContext } from '@/lib/utils';
import { TabNav, type Tab } from './TabNav';
import { SettingsTab } from './SettingsTab';
import { ClientTab } from './ClientTab';
import { ClientLabelById } from './ClientLabelById';
import { NewRecordTab, type NewRecordSubmitData } from './NewRecordTab';
import { CreateActivityTab, type CreateDefaults } from './CreateActivityTab';
import { Modal } from '@/app/components/shared/modal/Modal';
import { useRecordMutations } from '@/hooks/useRecordMutations';
import { useActivityRecords } from '@/hooks/useActivities';
import { parseApiError } from '@/app/lib/api/parseApiError';

interface ActivityDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Existing activity for edit/quickAdd; null in create mode (GH #258/#259). */
  activity?: ScheduleAdminDTO | null;
  mode: 'edit' | 'quickAdd' | 'create';
  /** Slot prefill for create mode (day index + start minutes). */
  createDefaults?: CreateDefaults;
}

/**
 * Mode dispatcher (GH #258/#259, spec §2.1.2). The parent owns only the
 * dialog shell — backdrop, saving lock, mode switch. Record hooks live in
 * {@link ExistingActivityContent}, so create mode never runs them (Rules of
 * Hooks — branches are components, not conditionals around hook calls).
 */
export function ActivityDetailsModal({ isOpen, onClose, activity, mode, createDefaults }: ActivityDetailsModalProps) {
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-details)] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-modal-title"
      data-testid="activity-details-modal"
    >
      {/* Backdrop — inert while a save is in flight (spec §2.1.7). */}
      <div
        data-testid="details-modal-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => {
          if (!saving) onClose();
        }}
      />

      {mode === 'create' ? (
        <CreateActivityPanel
          defaults={createDefaults!}
          saving={saving}
          onSavingChange={setSaving}
          onClose={onClose}
        />
      ) : (
        <ExistingActivityContent
          activity={activity!}
          mode={mode}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
    </div>
  );
}

/**
 * Create mode — single tab with the slot-prefilled creation form. No record
 * hooks, no delete footer; close cross is hidden while saving (Modal hides
 * the button when onClose is undefined).
 */
function CreateActivityPanel({
  defaults,
  saving,
  onSavingChange,
  onClose,
}: {
  defaults: CreateDefaults;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Новое занятие"
      titleId="activity-modal-title"
      onClose={saving ? undefined : onClose}
      footer={null}
      testId="activity-details-modal-container"
    >
      <TabNav
        tabs={[{ id: 'create', label: 'Создание занятия' }]}
        activeTab="create"
        onTabChange={() => {}}
      />
      <div className="flex-1 flex flex-col overflow-y-auto" style={{ backgroundColor: 'var(--white)' }}>
        <CreateActivityTab defaults={defaults} onSavingChange={onSavingChange} onSaved={onClose} />
      </div>
    </Modal>
  );
}

/**
 * Edit/quickAdd mode — the previous modal body verbatim (hooks, tabs memo,
 * handlers, delete footer). Extracted so its hooks are conditional at the
 * COMPONENT level, which satisfies the Rules of Hooks.
 */
function ExistingActivityContent({
  activity,
  mode,
  isOpen,
  onClose,
}: {
  activity: ScheduleAdminDTO;
  mode: 'edit' | 'quickAdd';
  isOpen: boolean;
  onClose: () => void;
}) {
  const { services, updateActivity, deleteActivity } = useScheduleData();
  const { showToast } = useUI();

  const [activeTab, setActiveTab] = useState(mode === 'quickAdd' ? 'new-record' : 'settings');

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

  // Own data — context records is now one server page; activity records need
  // the full set (#191). GH #140: point hook on ['records','activity',id].
  const { data: activityRecords = [] } = useActivityRecords(activity.id, isOpen);

  // GH #140 US-2: each record tab resolves its OWN client via useClient (inside
  // ClientLabelById) — no clients-list dependency. Every tab (not just the
  // active one) shows the resolved name+phone; shared ['client', id] dedupes
  // across tabs of the same client and with ClientQuickCard.
  const tabs: Tab[] = useMemo(() => {
    const settingsTab: Tab = { id: 'settings', label: 'Настройка' };
    const clientTabs: Tab[] = activityRecords.map((record) => {
      // #257: seats = len(visits) — anonymous seats are visits with
      // visitor_id = null; no separate counter field.
      const totalSeats = record.visits.length;
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

  // Switch to new record tab
  const handleAddClick = useCallback(() => {
    setActiveTab('new-record');
  }, []);

  // New record submit handler — delegates to useRecordMutations hook.
  // GH #221: the submit payload is a disjoint union — `picked` carries the
  // picked client_id (bind by id, resolve-or-create skipped); `unpicked`
  // carries the visible formatted phone + name (resolve-or-create path,
  // Task 7 replaces it with digits resolution).
  const handleNewRecordSubmit = useCallback(
    async (data: NewRecordSubmitData) => {
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

  // Delete record handler — ClientTab owns the #285 deferred flow (shared
  // useDeleteRecord hook + DeleteDialog; DELETE commit + undo toast live in
  // the PendingActions pipeline) and calls back here at click time — right
  // after the dry-run/dialog step (spec D6). Keep today's post-delete
  // navigation only — no second delete.
  const handleDeleteRecord = useCallback((_recordId: string) => {
    setActiveTab('settings');
  }, []);

  // Content renderer per active tab
  const renderContent = () => {
    if (activeTab === 'new-record') {
      return (
        <NewRecordTab
          activity={activity}
          serviceTariffs={serviceTariffs}
          onSubmit={handleNewRecordSubmit}
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

  // Activity context header label — DTO carries date + time display caches.
  const contextLabel = activity.date
    ? formatActivityContext(new Date(activity.date + 'T' + activity.time + ':00'))
    : '';

  return (
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
  );
}
