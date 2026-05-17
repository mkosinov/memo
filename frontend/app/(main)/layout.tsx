'use client';

import React from 'react';
import { Sidebar } from '@/app/components/layout/Sidebar';
import { useUI } from '@/contexts/UIContext';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sidebarCollapsed, rightPanelCollapsed } = useUI();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div
        className="flex-1 flex flex-col min-w-0 transition-all duration-300"
        style={{
          marginLeft: sidebarCollapsed ? 'var(--sidebar-collapsed-w)' : 'var(--sidebar-w)',
          marginRight: rightPanelCollapsed ? '0' : 'var(--right-w)',
        }}
      >
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
