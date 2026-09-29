#!/usr/bin/env bash
# ECS deploy helpers used by .github/workflows/deploy.yml.
#
# Requires: aws CLI v2, jq, and DEPLOY_CONFIG (JSON output `deploy_config` of the
# Terraform platform module) in the environment.
#
# Usage:
#   scripts/deploy/ecs.sh register <task-key> <image-uri>   -> prints new task definition ARN
#   scripts/deploy/ecs.sh run-task <task-definition-arn>     -> runs to completion, fails on non-zero exit
#   scripts/deploy/ecs.sh update-service <service-key> <task-definition-arn>
#   scripts/deploy/ecs.sh wait-stable <service-key>...
set -euo pipefail

config() { jq -r "$1" <<<"${DEPLOY_CONFIG:?DEPLOY_CONFIG is not set}"; }

cluster() { config '.cluster'; }

# Registers a new revision of a Terraform-managed family with a different image. All other
# settings (env, secrets, sizes, roles) come from the latest revision Terraform wrote.
register() {
  local key="$1" image="$2" family
  family="$(config ".task_families[\"$key\"]")"
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    jq --arg image "$image" --arg release "${image##*:}" '
      .containerDefinitions[0].image = $image
      # The release (commit SHA) groups errors by version (ADR-0029).
      | .containerDefinitions[0].environment =
          ((.containerDefinitions[0].environment // [])
            | map(select(.name != "RELEASE")) + [{name: "RELEASE", value: $release}])
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)' >"/tmp/td-$key.json"
  aws ecs register-task-definition --cli-input-json "file:///tmp/td-$key.json" \
    --query taskDefinition.taskDefinitionArn --output text
}

run_task() {
  local task_definition="$1" subnets security_groups task_arn exit_code
  subnets="$(config '.subnets | join(",")')"
  security_groups="$(config '.security_groups | join(",")')"
  task_arn="$(aws ecs run-task \
    --cluster "$(cluster)" \
    --launch-type FARGATE \
    --task-definition "$task_definition" \
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_groups],assignPublicIp=DISABLED}" \
    --started-by "github-deploy" \
    --query 'tasks[0].taskArn' --output text)"
  echo "Started $task_arn" >&2

  aws ecs wait tasks-stopped --cluster "$(cluster)" --tasks "$task_arn"
  exit_code="$(aws ecs describe-tasks --cluster "$(cluster)" --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  if [[ "$exit_code" != "0" ]]; then
    echo "Task $task_arn failed with exit code $exit_code" >&2
    aws ecs describe-tasks --cluster "$(cluster)" --tasks "$task_arn" \
      --query 'tasks[0].{stoppedReason:stoppedReason,containers:containers[].reason}' >&2
    exit 1
  fi
  echo "Task $task_arn completed" >&2
}

update_service() {
  local key="$1" task_definition="$2"
  aws ecs update-service --cluster "$(cluster)" --service "$(config ".services[\"$key\"]")" \
    --task-definition "$task_definition" --query 'service.serviceName' --output text
}

wait_stable() {
  local services=()
  for key in "$@"; do services+=("$(config ".services[\"$key\"]")"); done
  # Circuit breaker rolls back failed deployments; the waiter then reports failure.
  aws ecs wait services-stable --cluster "$(cluster)" --services "${services[@]}"
}

command="${1:-}"
shift || true
case "$command" in
  register) register "$@" ;;
  run-task) run_task "$@" ;;
  update-service) update_service "$@" ;;
  wait-stable) wait_stable "$@" ;;
  *)
    echo "usage: $0 {register|run-task|update-service|wait-stable} ..." >&2
    exit 2
    ;;
esac
