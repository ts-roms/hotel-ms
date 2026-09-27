# ADR-0010: AWS environments and deploy pipeline

- Status: Accepted, 2026-09-27
- Blueprint: §19, §21, §24. Decision D5 (ADR-0001).

## Decision

**Infrastructure** is defined in Terraform. The reusable module is
`infrastructure/terraform/modules/platform`, with one root per environment
(`envs/staging`; production copies it with larger sizes).

| Concern  | Choice                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region   | `ap-southeast-1`                                                                                                                                                                                    |
| Network  | VPC across 2–3 AZs. The ALB sits in public subnets. Tasks, RDS and Redis sit in private subnets. Task egress is limited to HTTPS plus the data-tier ports. VPC flow logs record rejected traffic.   |
| Compute  | ECS Fargate services `api`, `worker`, `web`. `migrate` and `db-bootstrap` are one-off tasks.                                                                                                        |
| Edge     | ALB (TLS 1.3 policy) with WAF (AWS common and bad-inputs rule sets, per-IP rate limit). `/api/*` goes to the API, everything else to the web app. `/health/*` and `/api/docs*` answer 404 publicly. |
| Database | RDS PostgreSQL 17 with `rds.force_ssl`, KMS encryption, PITR (7 days staging / 35 production) and Performance Insights. The admin password is managed by RDS in Secrets Manager.                    |
| Redis    | ElastiCache Valkey ×2 (cache `allkeys-lru`, queue `noeviction` with a replica), with TLS and AUTH.                                                                                                  |
| Secrets  | One Secrets Manager secret per environment, KMS-encrypted. Each key is injected into containers individually by ECS.                                                                                |
| Email    | SES v2 domain identity and configuration set. The worker's task role may only send from that identity.                                                                                              |
| CI → AWS | GitHub OIDC. The deploy role trusts only `repo:<owner>/<repo>:environment:<env>`. There are no long-lived keys.                                                                                     |

**Deploys** (`.github/workflows/deploy.yml`):

1. Build and push `api`, `worker`, `web` and `migrate` images tagged with the commit SHA (immutable ECR tags).
2. Register new revisions of the Terraform-managed task families, with only the image changed.
3. Run `db-bootstrap` (idempotent role creation and password rotation), then `migrate` (`prisma migrate deploy` + catalog sync). Either failing stops the deploy.
4. Update the services. The ECS deployment circuit breaker rolls back automatically.
5. Smoke-test through the public URL.

Staging deploys automatically after CI passes on `main`. Production is a manual dispatch of a SHA
from `main`, gated by required reviewers on the `production` GitHub environment.

## Consequences

- Terraform ignores `task_definition` drift on services. Configuration changes, such as a new
  environment variable, go live on the next deploy.
- Generated secrets are also present in Terraform state. The state bucket must be encrypted,
  versioned and access-restricted.
- Not yet: VPC interface endpoints (to drop NAT egress), a cross-region backup copy, the
  monthly restore drill automation (blueprint §21), alarms/dashboards, and a separate
  production root. These come before production launch.
- Nothing here has been applied to a real AWS account yet. `terraform validate`, `fmt` and a
  Trivy scan run in CI.
