# ADR-0001: Launch decisions (blueprint §28 defaults)

- Status: Accepted (defaults), 2026-09-27. Any of these can be reopened.
- Context: The blueprint listed 12 decisions that materially change the architecture. The
  product owner said "go ahead", so implementation starts on the proposed defaults.

| #   | Decision                              | Accepted default                                                                                                                                    | Where it shows up in code                     |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| D1  | SaaS or one group's internal platform | Multi-organization SaaS data model. Organizations are provisioned by the platform operator. No self-signup and no subscription billing yet.         | `provisionOrganization()`; no signup route    |
| D2  | Launch jurisdiction                   | Philippines only (PHP, Asia/Manila, en-PH). Architecture stays multi-jurisdiction. **Tax/BIR and privacy counsel needed before the finance phase.** | Demo data; no hard-coded tz/currency anywhere |
| D3  | Guest profile scope                   | Organization-level profile. Property staff see stays only for authorized properties.                                                                | Guests module (Phase 2)                       |
| D4  | Authentication                        | Built in-house: argon2id, opaque sessions, TOTP MFA next. SSO later.                                                                                | ADR-0006                                      |
| D5  | Cloud and region                      | AWS `ap-southeast-1`, DR copies to another region                                                                                                   | Infrastructure (Phase 0 remainder)            |
| D6  | Payments                              | One online gateway at launch. Card terminals recorded manually.                                                                                     | Finance phase                                 |
| D7  | Payroll                               | Out of scope. Export attendance, overtime and leave.                                                                                                | HR phase                                      |
| D8  | OTA / channel manager                 | Not at MVP. The inventory model is ready for it.                                                                                                    | PMS phase                                     |
| D9  | Offline behaviour                     | Read-only emergency packs plus cached PWA. No offline writes.                                                                                       | Operations phase                              |
| D10 | Guest ID verification                 | Manual staff review of an uploaded ID. Retention-limited storage.                                                                                   | Guest phase                                   |
| D11 | Year-1 scale                          | ≤ 20 properties / ≤ 2,000 rooms, single cell                                                                                                        | Sizing only                                   |
| D12 | FullCalendar premium                  | Buy the licence                                                                                                                                     | Calendar phase                                |

## Consequences

Changing D1, D2, D4 or D9 later is expensive. Revisit them before the phase that
depends on each one starts.
