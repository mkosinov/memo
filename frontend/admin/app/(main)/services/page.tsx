'use client';

import React, { useState } from 'react';
import { useCreateService } from '@/hooks/useServicesMutations';
import { useUI } from '@/contexts/UIContext';
import { ServicesTable } from './components/ServicesTable';
import { ServiceModal } from './components/ServiceModal';

export default function ServicesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const createService = useCreateService();
  const { showToast } = useUI();

  const handleCreate = async (data: Record<string, unknown>) => {
    await createService.mutateAsync(data as never);
    showToast('Услуга создана', undefined);
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          Управление услугами
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm rounded-lg text-white transition-colors"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          + Добавить услугу
        </button>
      </div>

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--line)', backgroundColor: 'var(--white)' }}
      >
        <ServicesTable />
      </div>

      {/* Create Modal */}
      {showCreate && (
        <ServiceModal
          mode="create"
          service={null}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
          title="Новая услуга"
          subtitle="Заполните данные услуги"
        />
      )}
    </div>
  );
}
