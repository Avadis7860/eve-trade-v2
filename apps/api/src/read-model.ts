import type {
  OpportunityObservation,
  OpportunityObservationScope,
} from "@eve-trade/contracts";

export interface OpportunityReadModel {
  listAllObservations(): Promise<OpportunityObservation[]>;
  listObservations(opportunityId: string): Promise<OpportunityObservation[]>;
}

export type ScopeAuthorizer = (
  scope: OpportunityObservationScope,
) => boolean;

export const publicOnlyScopeAuthorizer: ScopeAuthorizer = (scope) =>
  scope.principal_scope === "PUBLIC";
