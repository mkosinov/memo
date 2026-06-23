import type { VisitStatus } from '@memo/domain';
import {
  WaitingIcon,
  VisitedIcon,
  MissedIcon,
  CancelledIcon,
} from '../icons/StatusIcons';
import type { ComponentType } from 'react';

export interface VisitStatusMeta {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  Icon: ComponentType<{ className?: string }>;
  /** Hex color for the icon tint (e.g. '#b45309' for amber). */
  color: string;
}

export const VISIT_STATUS_CONFIG: Record<VisitStatus, VisitStatusMeta> = {
  waiting: {
    label: 'Ожидание',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-700 dark:text-amber-300',
    borderClass: 'border-amber-500',
    Icon: WaitingIcon,
    color: '#b45309',
  },
  visited: {
    label: 'Посетил',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    borderClass: 'border-emerald-500',
    Icon: VisitedIcon,
    color: '#059669',
  },
  missed: {
    label: 'Неявка',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textClass: 'text-red-700 dark:text-red-300',
    borderClass: 'border-red-500',
    Icon: MissedIcon,
    color: '#dc2626',
  },
  cancelled: {
    label: 'Отменён',
    bgClass: 'bg-gray-100 dark:bg-gray-800',
    textClass: 'text-gray-700 dark:text-gray-300',
    borderClass: 'border-gray-500',
    Icon: CancelledIcon,
    color: '#6b7280',
  },
};

/** Default display order: waiting → visited → cancelled → missed (Неявка last). */
export const VISIT_STATUS_ORDER: VisitStatus[] = ['waiting', 'visited', 'cancelled', 'missed'];
