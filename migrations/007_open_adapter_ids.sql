BEGIN;

ALTER TABLE action_record
  DROP CONSTRAINT IF EXISTS action_record_executor_check;

ALTER TABLE action_execution
  DROP CONSTRAINT IF EXISTS action_execution_requested_executor_check;

COMMIT;
