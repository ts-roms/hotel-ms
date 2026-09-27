-- AlterTable
ALTER TABLE "employee_documents" ADD COLUMN     "deletion_reason" TEXT,
ADD COLUMN     "stored_at" TIMESTAMPTZ(3);



-- =======================================================================================
-- Hand-written (ADR-0021)
-- =======================================================================================

-- Every existing document was stored in the same request that created its row.
UPDATE employee_documents SET stored_at = created_at;
UPDATE employee_documents SET deletion_reason = 'USER' WHERE deleted_at IS NOT NULL;

ALTER TABLE employee_documents DROP CONSTRAINT employee_documents_deleted;
ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_deleted CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deletion_reason = 'USER' AND deleted_by IS NOT NULL)
    OR (deleted_at IS NOT NULL AND deletion_reason = 'RETENTION' AND deleted_by IS NULL)
  ),
  ADD CONSTRAINT employee_documents_stored CHECK (deleted_at IS NULL OR stored_at IS NOT NULL);

GRANT UPDATE (stored_at, deletion_reason) ON employee_documents TO app_rw;
-- Only unfinished uploads may be deleted outright; stored documents are soft-deleted.
GRANT DELETE ON employee_documents TO app_rw;
CREATE FUNCTION app.forbid_stored_document_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stored_at IS NOT NULL THEN
    RAISE EXCEPTION 'stored employee documents are soft-deleted, never removed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER employee_documents_delete_guard
  BEFORE DELETE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION app.forbid_stored_document_delete();
