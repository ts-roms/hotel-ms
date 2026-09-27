# Application secrets, generated here and stored KMS-encrypted in Secrets Manager. ECS
# injects individual JSON keys into containers at start; they never appear in task
# definitions, images or CI logs.
#
# Note: generated values also live in the (encrypted, access-controlled) Terraform state.

resource "random_password" "db" {
  for_each = toset(["owner", "app", "system"])
  length   = 40
  special  = false
}

resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "random_bytes" "data_key" {
  length = 32
}

locals {
  db_host = aws_db_instance.postgres.address
  db_url = {
    for role, user in { owner = "hotel_owner", app = "hotel_app", system = "hotel_system" } :
    role => "postgresql://${user}:${random_password.db[role].result}@${local.db_host}:5432/hotel?sslmode=require"
  }
  redis_url = {
    for key, group in aws_elasticache_replication_group.redis :
    key => "rediss://:${random_password.redis_auth[key].result}@${group.primary_endpoint_address}:6379"
  }
}

resource "aws_secretsmanager_secret" "app" {
  name        = "${var.name}/app"
  description = "Runtime configuration secrets for ${var.name}"
  kms_key_id  = aws_kms_key.platform.arn
  tags        = local.tags
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL         = local.db_url.app
    DATABASE_OWNER_URL   = local.db_url.owner
    DATABASE_SYSTEM_URL  = local.db_url.system
    DB_OWNER_PASSWORD    = random_password.db["owner"].result
    DB_APP_PASSWORD      = random_password.db["app"].result
    DB_SYSTEM_PASSWORD   = random_password.db["system"].result
    REDIS_CACHE_URL      = local.redis_url.cache
    REDIS_QUEUE_URL      = local.redis_url.queue
    SESSION_SECRET       = random_password.session_secret.result
    DATA_ENCRYPTION_KEYS = "k1:${random_bytes.data_key.base64}"
  })
}
