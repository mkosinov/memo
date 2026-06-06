'use client';

import React, { useState } from 'react';
import { useCreateLocation } from '@/hooks/useLocationsMutations';
import { useUI } from '@/contexts/UIContext';
import { LocationsTable } from './components/LocationsTable';
import { LocationModal } from './components/LocationModal';

export default function LocationsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const createLocation = useCreateLocation();
  const { showToast } = useUI();

  const handleCreate = async (data: Record<string, unknown>) => {
    await createLocation.mutateAsync(data as never);
    showToast('Локация создана');
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          Управление локациями
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm rounded-lg text-white transition-colors"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          + Добавить локацию
        </button>
      </div>

      {/* Table card */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <LocationsTable />
      </div>

      {/* Create modal */}
      {showCreate && (
        <LocationModal
          mode="create"
          location={null}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
          title="Новая локация"
          subtitle="Заполните данные локации"
        />
      )}
    </div>
  );
}
