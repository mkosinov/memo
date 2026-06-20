import type { VisitStatus } from '@memo/domain';
import { Clock, Check, X, Slash } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface VisitStatusMeta {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  icon: LucideIcon;
}

export const VISIT_STATUS_CONFIG: Record<VisitStatus, VisitStatusMeta> = {
  waiting: {
    label: 'Ожидание',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-700 dark:text-amber-300',
    borderClass: 'border-amber-500',
    icon: Clock,
  },
  visited: {
    label: 'Посетил',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    borderClass: 'border-emerald-500',
    icon: Check,
  },
  missed: {
    label: 'Неявка',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textClass: 'text-red-700 dark:text-red-300',
    borderClass: 'border-red-500',
    icon: X,
  },
  cancelled: {
    label: 'Отменён',
    bgClass: 'bg-gray-100 dark:bg-gray-800',
    textClass: 'text-gray-700 dark:text-gray-300',
    borderClass: 'border-gray-500',
    icon: Slash,
  },
};

export const VISIT_STATUS_ORDER: VisitStatus[] = ['waiting', 'visited', 'missed', 'cancelled'];
