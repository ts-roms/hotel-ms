data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  tags = merge(var.tags, {
    Project     = "hotel-platform"
    Environment = var.environment
    ManagedBy   = "terraform"
  })

  ports = {
    api = 48100
    web = 43100
  }

  region     = data.aws_region.current.region
  account_id = data.aws_caller_identity.current.account_id

  images = ["api", "worker", "web", "migrate"]
}

# KMS key for this environment's secrets, logs, database and backups.
resource "aws_kms_key" "platform" {
  description             = "${var.name} data encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = local.tags
}

resource "aws_kms_alias" "platform" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.platform.key_id
}

# CloudWatch Logs must be allowed to use the key for encrypted log groups.
resource "aws_kms_key_policy" "platform" {
  key_id = aws_kms_key.platform.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${local.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = {
          ArnLike = { "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/${var.name}/*" }
        }
      },
    ]
  })
}

resource "aws_ecr_repository" "images" {
  for_each             = toset(local.images)
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.environment != "production"

  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.platform.arn
  }
  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each   = aws_ecr_repository.images
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 50 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "services" {
  for_each          = toset(["api", "worker", "web", "migrate", "db-bootstrap"])
  name              = "/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.platform.arn
  tags              = local.tags
  depends_on        = [aws_kms_key_policy.platform]
}
