-- Indexes found missing by the load test (ADR-0034): foreign keys followed on busy screens,
-- and today's room assignments by property.

-- CreateIndex
CREATE INDEX "housekeeping_tasks_organization_id_room_id_idx" ON "housekeeping_tasks"("organization_id", "room_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_folio_id_idx" ON "payments"("organization_id", "folio_id");

-- CreateIndex
CREATE INDEX "reservation_rooms_organization_id_reservation_id_idx" ON "reservation_rooms"("organization_id", "reservation_id");

-- CreateIndex
CREATE INDEX "reservation_rooms_organization_id_guest_id_idx" ON "reservation_rooms"("organization_id", "guest_id");

-- CreateIndex
CREATE INDEX "reservations_organization_id_booker_guest_id_idx" ON "reservations"("organization_id", "booker_guest_id");

-- CreateIndex
CREATE INDEX "room_assignments_organization_id_property_id_end_date_idx" ON "room_assignments"("organization_id", "property_id", "end_date");

-- CreateIndex
CREATE INDEX "stays_organization_id_room_id_idx" ON "stays"("organization_id", "room_id");


-- The combined-expression trigram index was never used: searches filter each column with
-- ILIKE, which is not leakproof, so under row-level security no trigram index can serve it.
DROP INDEX IF EXISTS guests_search_trgm;
