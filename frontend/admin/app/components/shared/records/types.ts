/**
 * Shared types for record-level atoms.
 *
 * `RecordWithDerived` augments the API record with a computed `status`
 * (derived from visits via `computeRecordStatus`). Both `ClientRecordTab`
 * and `ClientTab` will feed this shape to the atoms.
 */
import type { VisitStatus } from '@memo/domain';
import type {
  RecordResponse,
  VisitResponse,
  PaymentResponse,
  ClientResponse,
  TariffResponse,
} from '@memo/api-client';

/** Minimal client info needed by record-level atoms (name + phone). */
export type ClientInfo = Pick<ClientResponse, 'id' | 'name' | 'phone'>;

/** Record without the API-provided status (which is stale/Wave-5). */
export type RecordWithoutStatus = Omit<RecordResponse, 'status'>;

/** The data bundle that parent wrappers assemble for the atom tree. */
export interface RecordWithDerived {
  record: RecordWithoutStatus;
  status: VisitStatus;
  visits: VisitResponse[];
  payments: PaymentResponse[];
  client: ClientInfo | null;
  tariffs: TariffResponse[];
}
