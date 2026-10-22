/**
 * Per-tariff booking data shown in the booking overlay (#499):
 * one seat counter per tariff with its price next to it.
 */
export interface TariffView {
  id: string;
  title: string;
  price: number;
}
