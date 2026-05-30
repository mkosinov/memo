import type { PrivateBookingView } from '@/app/lib/model/view/booking';
import type { PrivateBookingDTO } from '@/app/lib/model/dto/booking';

/** PrivateBookingView → PrivateBookingDTO: prepares form state for API submission */
export function toPrivateBookingDTO(
  model: PrivateBookingView,
): PrivateBookingDTO {
  return {
    date: model.date,
    time: model.time,
    material: model.material,
    name: model.name,
    phone: model.phone,
    confirmation_method: model.confirmationMethod,
    price: model.price,
  };
}
