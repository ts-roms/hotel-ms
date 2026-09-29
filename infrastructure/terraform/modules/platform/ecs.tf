# ECS on Fargate. Terraform owns the task definition families and their configuration;
# the deploy workflow registers new revisions of the same families with a new image tag
# (see .github/workflows/deploy.yml). Configuration changes made here therefore go live
# with the next deploy, which is why services ignore task_definition drift.

resource "aws_ecs_cluster" "main" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
  tags = local.tags
}

locals {
  app_secret = aws_secretsmanager_secret.app.arn
  secret     = { for key in ["DATABASE_URL", "DATABASE_OWNER_URL", "DATABASE_SYSTEM_URL", "REDIS_CACHE_URL", "REDIS_QUEUE_URL", "SESSION_SECRET", "DATA_ENCRYPTION_KEYS", "DB_OWNER_PASSWORD", "DB_APP_PASSWORD", "DB_SYSTEM_PASSWORD", "PAYMENT_SANDBOX_SECRET", "SENTRY_DSN"] : key => "${local.app_secret}:${key}::" }

  # Observability (ADR-0029): traces to the collector sidecar, errors to Sentry.
  tracing_env = var.tracing_enabled ? {
    OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318"
    OTEL_TRACES_SAMPLER_ARG     = tostring(var.tracing_sample_ratio)
    OTEL_RESOURCE_ATTRIBUTES    = "deployment.environment=${var.environment}"
  } : {}
  error_env     = { SENTRY_ENVIRONMENT = var.environment }
  error_secrets = var.sentry_enabled ? ["SENTRY_DSN"] : []
  traced        = var.tracing_enabled ? ["api", "worker"] : []
  public_url    = "https://${var.domain_name}"
  guest_url     = "https://${var.guest_domain_name}"

  containers = {
    api = {
      image   = "api"
      command = null
      port    = local.ports.api
      environment = {
        NODE_ENV                = "production"
        API_PORT                = tostring(local.ports.api)
        WEB_ORIGIN              = local.public_url
        APP_PUBLIC_URL          = local.public_url
        API_PUBLIC_ORIGIN       = local.public_url
        GUEST_ORIGIN            = local.guest_url
        GUEST_PUBLIC_URL        = local.guest_url
        PAYMENT_SANDBOX_ENABLED = tostring(var.payment_sandbox_enabled)
        TRUST_PROXY_HOPS        = "1"
        COOKIE_SECURE           = "true"
        OPENAPI_ENABLED         = "false"
        LOG_LEVEL               = "info"
        STORAGE_DRIVER          = "s3"
        STORAGE_BUCKET          = aws_s3_bucket.documents.bucket
        STORAGE_KMS_KEY_ID      = aws_kms_key.platform.arn
        AWS_REGION              = local.region
      }
      secrets = concat(
        ["DATABASE_URL", "REDIS_CACHE_URL", "REDIS_QUEUE_URL", "SESSION_SECRET", "DATA_ENCRYPTION_KEYS"],
        var.payment_sandbox_enabled ? ["PAYMENT_SANDBOX_SECRET"] : [],
        local.error_secrets,
      )
    }
    worker = {
      image   = "worker"
      command = null
      port    = null
      environment = {
        NODE_ENV              = "production"
        EMAIL_TRANSPORT       = "ses"
        EMAIL_FROM            = var.email_from
        AWS_REGION            = local.region
        SES_CONFIGURATION_SET = aws_sesv2_configuration_set.main.configuration_set_name
        SMS_TRANSPORT         = "sns"
        LOG_LEVEL             = "info"
      }
      secrets = concat(["DATABASE_SYSTEM_URL", "REDIS_QUEUE_URL"], local.error_secrets)
    }
    web = {
      image       = "web"
      command     = null
      port        = local.ports.web
      environment = { NODE_ENV = "production", PORT = tostring(local.ports.web), HOSTNAME = "0.0.0.0" }
      secrets     = []
    }
    guest = {
      image       = "guest"
      command     = null
      port        = local.ports.guest
      environment = { NODE_ENV = "production", PORT = tostring(local.ports.guest), HOSTNAME = "0.0.0.0" }
      secrets     = []
    }
    migrate = {
      image       = "migrate"
      command     = null
      port        = null
      environment = { NODE_ENV = "production", SEED_DEMO = "false" }
      secrets     = ["DATABASE_OWNER_URL", "DATABASE_URL", "DATABASE_SYSTEM_URL"]
    }
    db-bootstrap = {
      image   = "migrate"
      command = ["node", "dist/bootstrap/run.js"]
      port    = null
      environment = {
        DB_HOST    = aws_db_instance.postgres.address
        DB_NAME    = "hotel"
        DB_SSLMODE = "require"
      }
      secrets = ["DB_OWNER_PASSWORD", "DB_APP_PASSWORD", "DB_SYSTEM_PASSWORD"]
    }
  }

  task_role = { api = "api", worker = "worker", web = "web", guest = "web", migrate = "migrate", db-bootstrap = "migrate" }
  task_size = merge(var.services, {
    migrate      = { cpu = 512, memory = 1024, desired_count = 0 }
    db-bootstrap = { cpu = 256, memory = 512, desired_count = 0 }
  })
}

resource "aws_ecs_task_definition" "task" {
  for_each                 = local.containers
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.task_size[each.key].cpu
  memory                   = local.task_size[each.key].memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[local.task_role[each.key]].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # The app is container 0 (the deploy swaps its image); the collector, where enabled, is 1.
  container_definitions = jsonencode(concat([merge(
    {
      name                   = each.key
      image                  = "${aws_ecr_repository.images[each.value.image].repository_url}:${var.image_tag}"
      essential              = true
      readonlyRootFilesystem = contains(["api", "worker"], each.key) # web (.next cache) and Prisma CLI write to disk
      environment = [for k, v in merge(
        each.value.environment,
        contains(["api", "worker"], each.key) ? local.error_env : {},
        contains(local.traced, each.key) ? local.tracing_env : {},
      ) : { name = k, value = v }]
      secrets = concat(
        [for k in each.value.secrets : { name = k, valueFrom = local.secret[k] }],
        each.key == "db-bootstrap" ? [
          { name = "DB_ADMIN_USERNAME", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:username::" },
          { name = "DB_ADMIN_PASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
        ] : [],
      )
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.services[each.key].name
          awslogs-region        = local.region
          awslogs-stream-prefix = each.key
        }
      }
      linuxParameters = { initProcessEnabled = true }
      stopTimeout     = 30
    },
    each.value.port == null ? {} : { portMappings = [{ containerPort = each.value.port, protocol = "tcp" }] },
    each.value.command == null ? {} : { command = each.value.command },
    )],
    # OpenTelemetry collector (ADOT): OTLP in on localhost, traces out to X-Ray.
    contains(local.traced, each.key) ? [{
      name      = "otel-collector"
      image     = var.otel_collector_image
      essential = false
      command   = ["--config=/etc/ecs/ecs-default-config.yaml"]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.services[each.key].name
          awslogs-region        = local.region
          awslogs-stream-prefix = "otel"
        }
      }
    }] : [],
  ))

  tags = local.tags
}

resource "aws_ecs_service" "service" {
  for_each        = { for k, v in var.services : k => v }
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.task[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = contains(["api", "web", "guest"], each.key) ? [each.key] : []
    content {
      target_group_arn = aws_lb_target_group.service[load_balancer.value].arn
      container_name   = load_balancer.value
      container_port   = local.ports[load_balancer.value]
    }
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  health_check_grace_period_seconds = contains(["api", "web", "guest"], each.key) ? 30 : null
  enable_execute_command            = false
  propagate_tags                    = "SERVICE"

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
  depends_on = [aws_lb_listener.https]
  tags       = local.tags
}

# API scales on CPU; workers scale with queue depth later (custom metric).
resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.service["api"].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.services["api"].desired_count
  max_capacity       = var.services["api"].desired_count * 4
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# ---- SES --------------------------------------------------------------------------------

resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = var.name
  reputation_options {
    reputation_metrics_enabled = true
  }
  delivery_options {
    tls_policy = "REQUIRE"
  }
  tags = local.tags
}

resource "aws_sesv2_email_identity" "domain" {
  email_identity         = var.email_domain
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
  tags                   = local.tags
}
