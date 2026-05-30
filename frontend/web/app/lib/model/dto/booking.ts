/** DTO for sending a private (individual) booking to the API */
export interface PrivateBookingDTO {
  date: string;
  time: string;
  material: string;
  name: string;
  phone: string;
  confirmation_method: 'telegram' | 'whatsapp' | 'max';
  price: number;
}
