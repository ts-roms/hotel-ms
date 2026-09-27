output "alb_dns_name" {
  description = "Point domain_name (CNAME/alias) here."
  value       = aws_lb.main.dns_name
}

output "ses_dkim_tokens" {
  description = "Create CNAME <token>._domainkey.<email_domain> -> <token>.dkim.amazonses.com for each."
  value       = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
}

output "deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN variable of the matching GitHub environment."
  value       = aws_iam_role.deploy.arn
}

# Everything the deploy workflow needs, as one JSON value (GitHub environment variable
# DEPLOY_CONFIG), so the workflow holds no environment-specific literals.
output "deploy_config" {
  value = jsonencode({
    region          = local.region
    cluster         = aws_ecs_cluster.main.name
    ecr_registry    = split("/", aws_ecr_repository.images["api"].repository_url)[0]
    repositories    = { for k, repo in aws_ecr_repository.images : k => repo.name }
    task_families   = { for k, td in aws_ecs_task_definition.task : k => td.family }
    services        = { for k, svc in aws_ecs_service.service : k => svc.name }
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.tasks.id]
    public_url      = "https://${var.domain_name}"
  })
}
