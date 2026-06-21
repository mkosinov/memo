'use client';

import React from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Column {
  key: string;
  label: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

interface RecordTableProps {
  children: React.ReactNode;
  testId?: string;
}

interface HeaderProps {
  columns: Column[];
  isReadOnly?: boolean;
}

interface RowProps {
  columns: Column[];
  cells: Record<string, React.ReactNode>;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
}

interface AnonymRowProps {
  columns: Column[];
  cells: Record<string, React.ReactNode>;
  testId?: string;
}

interface TotalsRowProps {
  columns: Column[];
  cells: Record<string, React.ReactNode>;
  testId?: string;
}

interface AddRowProps {
  children: React.ReactNode;
  testId?: string;
}

interface EmptyStateProps {
  children?: React.ReactNode;
  testId?: string;
}

// ── Wrapper ──────────────────────────────────────────────────────────────────

function TableWrapper({ children, testId }: RecordTableProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--line)' }}
    >
      {children}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({ columns, isReadOnly }: HeaderProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-ink-mid border-b"
      style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
    >
      {columns.map((col) => (
        <span
          key={col.key}
          className={col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
          style={{ width: col.width }}
        >
          {col.label}
        </span>
      ))}
      {!isReadOnly && <span className="w-6 shrink-0" />}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function Row({ columns, cells, className = '', style, testId }: RowProps) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 text-sm ${className}`}
      style={{ borderColor: 'var(--line)', ...style }}
      data-testid={testId}
    >
      {columns.map((col) => {
        const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : '';
        return (
          <span
            key={col.key}
            className={alignClass}
            style={{ width: col.width }}
          >
            {cells[col.key]}
          </span>
        );
      })}
      {cells.__actions && <span className="w-6 shrink-0 text-center">{cells.__actions}</span>}
    </div>
  );
}

// ── AnonymRow (gray background) ──────────────────────────────────────────────

function AnonymRow({ columns, cells, testId }: AnonymRowProps) {
  return (
    <Row
      columns={columns}
      cells={cells}
      className="bg-[var(--surface)]"
      testId={testId}
    />
  );
}

// ── TotalsRow ────────────────────────────────────────────────────────────────

function TotalsRow({ columns, cells, testId }: TotalsRowProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-t text-sm"
      style={{ borderColor: 'var(--line)' }}
      data-testid={testId}
    >
      {columns.map((col) => {
        const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : '';
        return (
          <span
            key={col.key}
            className={alignClass}
            style={{ width: col.width }}
          >
            {cells[col.key]}
          </span>
        );
      })}
      <span className="w-6 shrink-0" />
    </div>
  );
}

// ── AddRow ───────────────────────────────────────────────────────────────────

function AddRow({ children, testId }: AddRowProps) {
  return (
    <div className="border-t" style={{ borderColor: 'var(--line)' }} data-testid={testId}>
      {children}
    </div>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ children, testId }: EmptyStateProps) {
  return (
    <div className="px-3 py-3 text-xs text-ink-light text-center" data-testid={testId}>
      {children ?? 'Нет данных'}
    </div>
  );
}

// ── Compound export ──────────────────────────────────────────────────────────

export const RecordTable = Object.assign(TableWrapper, {
  Header,
  Row,
  AnonymRow,
  TotalsRow,
  AddRow,
  EmptyState,
});
