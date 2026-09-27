# Staging environment (ADR-0010). Production is a copy of this directory with larger
# sizes, Multi-AZ, per-AZ NAT and 35-day PITR.
#
#   cd infrastructure/terraform/envs/staging
#   terraform init -backend-config=backend.hcl   # bucket/key/region/lock table, not committed
#   terraform plan -var-file=staging.tfvars

terraform {
  required_version = ">= 1.9"
  backend "s3" {}
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "ap-southeast-1"
  default_tags {
    tags = { Project = "hotel-platform", Environment = "staging" }
  }
}

variable "domain_name" {
  type = string
}

variable "certificate_arn" {
  type = string
}

variable "guest_domain_name" {
  type = string
}

variable "guest_certificate_arn" {
  type    = string
  default = null
}

variable "email_domain" {
  type = string
}

variable "github_repository" {
  type    = string
  default = "ts-roms/hotel-ms"
}

variable "create_github_oidc_provider" {
  type    = bool
  default = true
}

module "platform" {
  source = "../../modules/platform"

  name        = "hotel-staging"
  environment = "staging"

  domain_name           = var.domain_name
  certificate_arn       = var.certificate_arn
  guest_domain_name     = var.guest_domain_name
  guest_certificate_arn = var.guest_certificate_arn
  # Staging takes test payments through the sandbox gateway (ADR-0016).
  payment_sandbox_enabled     = true
  email_domain                = var.email_domain
  email_from                  = "Hotel Platform (staging) <no-reply@${var.email_domain}>"
  github_repository           = var.github_repository
  create_github_oidc_provider = var.create_github_oidc_provider

  availability_zones = ["ap-southeast-1a", "ap-southeast-1b"]
  single_nat_gateway = true

  db_instance_class        = "db.t4g.medium"
  db_multi_az              = false
  db_backup_retention_days = 7
  db_deletion_protection   = true

  cache_node_type = "cache.t4g.micro"
  queue_node_type = "cache.t4g.small"
  queue_replicas  = 1

  services = {
    api    = { cpu = 512, memory = 1024, desired_count = 1 }
    worker = { cpu = 256, memory = 512, desired_count = 1 }
    web    = { cpu = 256, memory = 512, desired_count = 1 }
    guest  = { cpu = 256, memory = 512, desired_count = 1 }
  }
}

output "alb_dns_name" {
  value = module.platform.alb_dns_name
}

output "ses_dkim_tokens" {
  value = module.platform.ses_dkim_tokens
}

output "deploy_role_arn" {
  value = module.platform.deploy_role_arn
}

output "deploy_config" {
  value = module.platform.deploy_config
}
