export type BookingStatus = 'draft' | 'pending' | 'confirmed' | 'cancelled' | 'completed';

export type ConfirmationMethod = 'telegram' | 'whatsapp' | 'max';

export interface PrivateBookingView {
  date: string;
  time: string;
  material: string;
  name: string;
  phone: string;
  confirmationMethod: ConfirmationMethod;
  price: number;
  status: BookingStatus;
  createdAt: string;
  /** Pre-fill from context — the selected day when user tapped the last card */
  preferredDate?: string;
  /** Pre-fill from context — the selected location filter */
  preferredLocation?: string;
}

export function createPrivateBookingView(
  preferredDate?: string,
  preferredLocation?: string,
  /** Prefill for the editable «Материал» input — first linked material title (GH #223 §9). */
  defaultMaterial?: string,
): PrivateBookingView {
  return {
    date: preferredDate ?? '',
    time: '12:00',
    material: defaultMaterial ?? 'Не определились',
    name: '',
    phone: '',
    confirmationMethod: 'telegram',
    price: 8200,
    status: 'draft',
    createdAt: new Date().toISOString(),
    preferredDate,
    preferredLocation,
  };
}
