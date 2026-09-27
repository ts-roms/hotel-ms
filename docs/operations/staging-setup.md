# Standing up staging (first time)

A one-time runbook. After it, every merge to `main` deploys itself (ADR-0010).

## Prerequisites

- An AWS account for staging, with administrator access for the person running Terraform.
- A domain you control, e.g. `staging.hotel.example.com`, and an **ACM certificate** for it in
  `ap-southeast-1`.
- An S3 bucket and DynamoDB table for Terraform state (or S3 native locking), encrypted and
  versioned.

## 1. Apply the infrastructure

```bash
cd infrastructure/terraform/envs/staging
```

Create `backend.hcl` (not committed) with the state bucket, key, region and lock settings,
and `staging.tfvars` with `domain_name`, `certificate_arn` and `email_domain`. Then:

```bash
terraform init -backend-config=backend.hcl
```

```bash
terraform plan -var-file=staging.tfvars -out=staging.plan
```

Review the plan, then apply it:

```bash
terraform apply staging.plan
```

If the account already has a GitHub OIDC provider, add `create_github_oidc_provider = false`.

## 2. DNS and email

- Point `domain_name` at the `alb_dns_name` output (alias or CNAME).
- Add the three DKIM CNAMEs from `ses_dkim_tokens`.
- A new SES account is in the **sandbox**: it can only send to verified addresses. Request
  production access in the SES console before inviting real users.

## 3. Connect GitHub

In the repository settings, create the **staging** environment and add these variables:

- `AWS_DEPLOY_ROLE_ARN`: the `deploy_role_arn` output.
- `DEPLOY_CONFIG`: the `deploy_config` output. Copy it with `terraform output -raw deploy_config`.

Create the **production** environment the same way from the production root, with required
reviewers.

## 4. First deploy

Merge to `main`, or re-run the latest successful CI on `main`. The `Deploy staging` workflow:

1. builds and pushes the images;
2. runs `db-bootstrap`, which creates `hotel_owner`, `hotel_app`, `hotel_system` and the
   `app_rw` / `app_system` groups;
3. runs migrations and syncs the permission catalog;
4. starts `api`, `worker` and `web`.

The very first `terraform apply` creates services that point at a `bootstrap` image tag,
which does not exist. They stay at zero healthy tasks until the first deploy registers real
images. This is expected.

## 5. First organization

Staging never seeds demo data (`SEED_DEMO=false`). Provision the first organization and its
administrator with a one-off run of the `migrate` task definition, overriding the command.
This is idempotent on the slug:

```bash
aws ecs run-task --cluster hotel-staging --launch-type FARGATE --task-definition hotel-staging-migrate --network-configuration "awsvpcConfiguration={subnets=[<private-subnets>],securityGroups=[<tasks-sg>]}" --overrides '{"containerOverrides":[{"name":"migrate","command":["node","dist/ops/provision-organization.js"],"environment":[{"name":"ORG_NAME","value":"ABC Hospitality Group"},{"name":"ORG_SLUG","value":"abc-hospitality"},{"name":"ADMIN_EMAIL","value":"gm@abc.example"},{"name":"ADMIN_NAME","value":"Ana Admin"}]}]}'
```

The subnets and security group are in the `deploy_config` output. The administrator then uses
**Forgot password** to set a password, which also proves they control the address. They
must enable two-step verification before managing members. A platform-operator console
for this is on the roadmap.
