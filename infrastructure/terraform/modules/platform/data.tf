# ---- PostgreSQL -----------------------------------------------------------------------
# The admin password is generated and rotated by RDS in Secrets Manager
# (manage_master_user_password); Terraform never sees it. Application roles are created
# by the db-bootstrap task (packages/database/src/bootstrap).

resource "aws_db_parameter_group" "postgres" {
  name   = "${var.name}-pg17"
  family = "postgres17"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
  parameter {
    # Kill sessions stuck in an open transaction (holding RLS context and locks).
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }
  tags = local.tags
}

resource "aws_db_instance" "postgres" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  db_name                       = "hotel"
  username                      = "hotel_admin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.platform.arn

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 4
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.platform.arn

  multi_az               = var.db_multi_az
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.data.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.postgres.name

  backup_retention_period  = var.db_backup_retention_days
  backup_window            = "18:00-19:00" # 02:00-03:00 Asia/Manila
  maintenance_window       = "sun:19:00-sun:20:00"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false
  deletion_protection      = var.db_deletion_protection

  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.platform.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  auto_minor_version_upgrade      = true

  tags = local.tags
}

# ---- Redis (Valkey): two instances, ADR-0007 --------------------------------------------

resource "aws_elasticache_subnet_group" "redis" {
  name       = var.name
  subnet_ids = module.vpc.database_subnets
}

resource "aws_elasticache_parameter_group" "cache" {
  name   = "${var.name}-cache"
  family = "valkey8"
  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }
}

resource "aws_elasticache_parameter_group" "queue" {
  name   = "${var.name}-queue"
  family = "valkey8"
  parameter {
    # BullMQ loses jobs if keys are evicted.
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "random_password" "redis_auth" {
  for_each = toset(["cache", "queue"])
  length   = 48
  special  = false
}

resource "aws_elasticache_replication_group" "redis" {
  for_each = {
    cache = { node_type = var.cache_node_type, replicas = 0, parameter_group = aws_elasticache_parameter_group.cache.name }
    queue = { node_type = var.queue_node_type, replicas = var.queue_replicas, parameter_group = aws_elasticache_parameter_group.queue.name }
  }

  replication_group_id = "${var.name}-${each.key}"
  description          = "${var.name} ${each.key}"
  engine               = "valkey"
  engine_version       = "8.0"
  node_type            = each.value.node_type
  num_cache_clusters   = 1 + each.value.replicas
  parameter_group_name = each.value.parameter_group
  port                 = 6379

  automatic_failover_enabled = each.value.replicas > 0
  multi_az_enabled           = each.value.replicas > 0

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.data.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.platform.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth[each.key].result

  snapshot_retention_limit = each.key == "queue" ? 3 : 0
  apply_immediately        = var.environment != "production"
  tags                     = local.tags
}
