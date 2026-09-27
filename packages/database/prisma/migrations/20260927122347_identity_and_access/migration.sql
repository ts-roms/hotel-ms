-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "identity_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "requested_ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "organization_invitations_organization_id_membership_id_idx" ON "organization_invitations"("organization_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_organization_id_id_key" ON "organization_invitations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_identity_id_idx" ON "mfa_recovery_codes"("identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_identity_id_idx" ON "password_reset_tokens"("identity_id");

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "organization_memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- Privileges and RLS (hand-written; see docs/database/conventions.md)
-- ---------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes TO app_rw;
GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO app_rw;
GRANT SELECT, INSERT, UPDATE ON organization_invitations TO app_rw;

CREATE FUNCTION app.current_invitation_token_hash() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.invitation_token_hash', true), '') $$;
GRANT EXECUTE ON FUNCTION app.current_invitation_token_hash() TO app_rw;

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_invitations TO app_rw
  USING (organization_id = app.current_org_id())
  WITH CHECK (organization_id = app.current_org_id());

-- An unauthenticated invitee presents the token; the API sets its SHA-256 as
-- app.invitation_token_hash and can then read exactly that one invitation, nothing else.
CREATE POLICY invitation_by_token ON organization_invitations FOR SELECT TO app_rw
  USING (token_hash = app.current_invitation_token_hash());

-- At most one open invitation per membership.
CREATE UNIQUE INDEX organization_invitations_one_open_per_membership
  ON organization_invitations (membership_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
