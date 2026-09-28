variable "name" {
  description = "Deployment name, e.g. hotel-staging. Prefixes every resource."
  type        = string
}

variable "environment" {
  description = "staging | production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "domain_name" {
  description = "Public host name of the staff app, e.g. staging.hotel.example.com (DNS managed outside this module)."
  type        = string
}

variable "guest_domain_name" {
  description = "Public host name of the guest portal, e.g. guest.staging.hotel.example.com (DNS managed outside this module)."
  type        = string
}

variable "guest_certificate_arn" {
  description = "ACM certificate for guest_domain_name when certificate_arn does not cover it; null to reuse certificate_arn."
  type        = string
  default     = null
}

variable "payment_sandbox_enabled" {
  description = "Serve the built-in sandbox payment gateway (ADR-0016). Never in production."
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate for domain_name, in the same region."
  type        = string
}

variable "email_from" {
  description = "From address for platform email, e.g. Hotel Platform <no-reply@hotel.example.com>."
  type        = string
}

variable "email_domain" {
  description = "Domain verified in SES for sending (DKIM records are output for your DNS)."
  type        = string
}

variable "github_repository" {
  description = "owner/repo allowed to deploy through GitHub OIDC."
  type        = string
}

variable "create_github_oidc_provider" {
  description = "Create the account-wide GitHub OIDC provider (only once per AWS account)."
  type        = bool
  default     = true
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "availability_zones" {
  description = "Two or three AZs."
  type        = list(string)
}

variable "single_nat_gateway" {
  description = "One NAT gateway (cheaper, staging) or one per AZ (production)."
  type        = bool
  default     = true
}

# ---- Database -------------------------------------------------------------------------

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 50
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_retention_days" {
  description = "Point-in-time recovery window (blueprint §21: 35 in production)."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

# ---- Cache / queue ----------------------------------------------------------------------

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "queue_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "queue_replicas" {
  description = "Read replicas for the queue Redis (automatic failover needs >= 1)."
  type        = number
  default     = 1
}

# ---- Services ---------------------------------------------------------------------------

variable "image_tag" {
  description = "Initial image tag for task definitions. Deploys register new revisions with the commit SHA."
  type        = string
  default     = "bootstrap"
}

variable "services" {
  description = "CPU/memory/count per service."
  type = map(object({
    cpu           = number
    memory        = number
    desired_count = number
  }))
  default = {
    api    = { cpu = 512, memory = 1024, desired_count = 2 }
    worker = { cpu = 256, memory = 512, desired_count = 1 }
    web    = { cpu = 256, memory = 512, desired_count = 2 }
    guest  = { cpu = 256, memory = 512, desired_count = 2 }
  }
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "deleted_document_retention_days" {
  description = "Days a deleted employee document stays recoverable (noncurrent S3 version)."
  type        = number
  default     = 30
}

variable "attendance_photo_expiry_days" {
  description = "Backstop expiry for punch selfies in S3; must exceed the longest retention HR can set (365 days)."
  type        = number
  default     = 400
}
