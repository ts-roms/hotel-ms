# Two-tier network: public subnets hold only the load balancer and NAT; tasks, the
# database and Redis live in private subnets without public IPs.

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = var.name
  cidr = var.vpc_cidr
  azs  = var.availability_zones

  public_subnets   = [for i, _ in var.availability_zones : cidrsubnet(var.vpc_cidr, 8, i)]
  private_subnets  = [for i, _ in var.availability_zones : cidrsubnet(var.vpc_cidr, 8, i + 10)]
  database_subnets = [for i, _ in var.availability_zones : cidrsubnet(var.vpc_cidr, 8, i + 20)]

  create_database_subnet_group = true
  enable_nat_gateway           = true
  single_nat_gateway           = var.single_nat_gateway
  enable_dns_hostnames         = true

  # VPC flow logs for incident investigation (rejected traffic only keeps volume low).
  enable_flow_log                                 = true
  flow_log_traffic_type                           = "REJECT"
  create_flow_log_cloudwatch_log_group            = true
  create_flow_log_cloudwatch_iam_role             = true
  flow_log_cloudwatch_log_group_retention_in_days = var.log_retention_days

  tags = local.tags
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTPS"
  vpc_id      = module.vpc.vpc_id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http_redirect" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 0
  to_port                      = 65535
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "ECS tasks"
  vpc_id      = module.vpc.vpc_id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  for_each                     = { api = local.ports.api, web = local.ports.web }
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

# Tasks reach AWS APIs (ECR, Secrets Manager, SES, CloudWatch Logs) over HTTPS through
# the NAT gateway, and the data tier on its ports. Nothing else.
# Replacing NAT egress with VPC interface endpoints is tracked for production hardening.
#trivy:ignore:AWS-0104
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "tasks_to_data" {
  for_each                     = { postgres = 5432, redis = 6379 }
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.data.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_security_group" "data" {
  name        = "${var.name}-data"
  description = "PostgreSQL and Redis, reachable only from tasks"
  vpc_id      = module.vpc.vpc_id
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "data_from_tasks" {
  for_each                     = { postgres = 5432, redis = 6379 }
  security_group_id            = aws_security_group.data.id
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}
