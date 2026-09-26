import type {
  EconomicOperation,
  OpportunityObservation,
  OpportunityObservationScope,
} from "@eve-trade/contracts";

export interface OpportunityReadModel {
  listAllObservations(): Promise<OpportunityObservation[]>;
  listObservations(opportunityId: string): Promise<OpportunityObservation[]>;
}

export interface EconomicOperationReadModel {
  listAll(): Promise<EconomicOperation[]>;
  get(operationId: string): Promise<EconomicOperation | null>;
  listObservations(operationId: string): Promise<EconomicOperation[]>;
}

export type ScopeAuthorizer = (
  scope: OpportunityObservationScope,
) => boolean;

export const publicOnlyScopeAuthorizer: ScopeAuthorizer = (scope) =>
  scope.principal_scope === "PUBLIC";
