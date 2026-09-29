-- Security review hardening (ADR-0033).

-- ---- Template sync: the system role may only add a template's own permissions ------------
-- It used to be able to insert any permission into any organization's role. The worker
-- connects as this role, so a compromised worker could have escalated privileges in every
-- tenant. Now a row is accepted only for a template-linked role of the same organization,
-- and only with a permission that template defines, which is all the catalog sync needs.
GRANT SELECT (key, permissions) ON role_templates TO app_system;
DROP POLICY template_sync_insert ON role_permissions;
CREATE POLICY template_sync_insert ON role_permissions FOR INSERT TO app_system WITH CHECK (
  EXISTS (
    SELECT 1
    FROM roles r
    JOIN role_templates t ON t.key = r.template_key
    WHERE r.id = role_permissions.role_id
      AND r.organization_id = role_permissions.organization_id
      AND role_permissions.permission_code = ANY (t.permissions)
  )
);

-- ---- Anonymization reaches guest notifications and order notes ---------------------------
GRANT UPDATE (title, body) ON guest_notifications TO app_rw;
GRANT UPDATE (notes) ON orders TO app_rw;
