CREATE OR REPLACE FUNCTION reject_economic_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'economic operation history is append-only; % is not permitted on %',
    TG_OP, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS economic_operations_immutable
  ON economic_operations;

CREATE TRIGGER economic_operations_immutable
BEFORE UPDATE OR DELETE ON economic_operations
FOR EACH ROW
EXECUTE FUNCTION reject_economic_operation_mutation();

DROP TRIGGER IF EXISTS economic_operation_observations_immutable
  ON economic_operation_observations;

CREATE TRIGGER economic_operation_observations_immutable
BEFORE UPDATE OR DELETE ON economic_operation_observations
FOR EACH ROW
EXECUTE FUNCTION reject_economic_operation_mutation();
