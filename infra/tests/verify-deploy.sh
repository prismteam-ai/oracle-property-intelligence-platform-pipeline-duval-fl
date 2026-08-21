#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# verify-deploy.sh — 9 deterministic acceptance signals for Oracle Pipeline
# Duval County CDK deployment.
#
# Exit 0 = ALL pass, Exit 1 = at least one failure.
###############################################################################

REGION="us-east-2"
PASS_COUNT=0
FAIL_COUNT=0
FAILURES=()

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }

signal_pass() {
  green "  PASS  $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

signal_fail() {
  red "  FAIL  $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("$1")
}

# Helper: check CloudFormation stack status
check_stack() {
  local stack_name="$1"
  local signal_label="$2"
  local status
  status=$(aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --region "$REGION" \
    --query "Stacks[0].StackStatus" \
    --output text 2>/dev/null) || status="MISSING"

  if [[ "$status" == "CREATE_COMPLETE" || "$status" == "UPDATE_COMPLETE" || "$status" == "UPDATE_ROLLBACK_COMPLETE" ]]; then
    signal_pass "$signal_label ($status)"
  else
    signal_fail "$signal_label (got: $status)"
  fi
}

# Helper: curl with retries
curl_check() {
  local url="$1"
  local expected_code="$2"
  local signal_label="$3"
  local max_attempts=5
  local sleep_secs=30
  local attempt=1
  local http_code

  while [ $attempt -le $max_attempts ]; do
    http_code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null) || http_code="000"
    if [ "$http_code" = "$expected_code" ]; then
      signal_pass "$signal_label (HTTP $http_code on attempt $attempt)"
      return
    fi
    if [ $attempt -lt $max_attempts ]; then
      echo "    Attempt $attempt/$max_attempts got HTTP $http_code, retrying in ${sleep_secs}s..."
      sleep $sleep_secs
    fi
    attempt=$((attempt + 1))
  done
  signal_fail "$signal_label (expected HTTP $expected_code, got $http_code after $max_attempts attempts)"
}

echo ""
echo "========================================="
echo " Oracle Pipeline Duval — Deploy Verify"
echo "========================================="
echo ""

# ── Signal 1-3: CloudFormation stack status ──────────────────────────────────
echo "── CloudFormation Stacks ──"
check_stack "PipelineStack"  "Signal 1: PipelineStack status"
check_stack "FrontendStack"  "Signal 2: FrontendStack status"
check_stack "AgentStack"     "Signal 3: AgentStack status"

# ── Signal 4: EC2 instance running ──────────────────────────────────────────
echo ""
echo "── EC2 Instance ──"
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:aws:cloudformation:stack-name,Values=PipelineStack" \
             "Name=instance-state-name,Values=running" \
  --region "$REGION" \
  --query "Reservations[].Instances[].InstanceId" \
  --output text 2>/dev/null) || INSTANCE_ID=""

if [[ -n "$INSTANCE_ID" && "$INSTANCE_ID" != "None" ]]; then
  signal_pass "Signal 4: EC2 instance running ($INSTANCE_ID)"
else
  signal_fail "Signal 4: EC2 instance running (no running instance found)"
fi

# ── Read stack outputs ──────────────────────────────────────────────────────
echo ""
echo "── Stack Outputs ──"
PUBLIC_DNS=$(aws cloudformation describe-stacks \
  --stack-name PipelineStack \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='PublicDNS'].OutputValue" \
  --output text 2>/dev/null) || PUBLIC_DNS=""

FRONTEND_URL=$(aws cloudformation describe-stacks \
  --stack-name FrontendStack \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendURL'].OutputValue" \
  --output text 2>/dev/null) || FRONTEND_URL=""

API_URL=$(aws cloudformation describe-stacks \
  --stack-name AgentStack \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text 2>/dev/null) || API_URL=""

echo "  PublicDNS:    ${PUBLIC_DNS:-<not available>}"
echo "  FrontendURL:  ${FRONTEND_URL:-<not available>}"
echo "  ApiGatewayUrl: ${API_URL:-<not available>}"

# ── Signal 5: EC2 HTTP endpoint (HTTPS deferred until custom domain) ─────────
echo ""
echo "── Endpoint Checks ──"
if [[ -n "$PUBLIC_DNS" && "$PUBLIC_DNS" != "None" ]]; then
  curl_check "http://${PUBLIC_DNS}" "200" "Signal 5: EC2 HTTP endpoint"
else
  signal_fail "Signal 5: EC2 HTTP endpoint (PublicDNS not available)"
fi

# ── Signal 6: API Gateway /agent endpoint ───────────────────────────────────
if [[ -n "$API_URL" && "$API_URL" != "None" ]]; then
  curl_check "${API_URL}agent" "200" "Signal 6: API Gateway /agent endpoint"
else
  signal_fail "Signal 6: API Gateway /agent endpoint (ApiGatewayUrl not available)"
fi

# ── Signal 7-8: Lambda existence ────────────────────────────────────────────
echo ""
echo "── Lambda Functions ──"
if aws lambda get-function --function-name oracle-pipeline-duval-agent --region "$REGION" > /dev/null 2>&1; then
  signal_pass "Signal 7: Lambda oracle-pipeline-duval-agent exists"
else
  signal_fail "Signal 7: Lambda oracle-pipeline-duval-agent exists"
fi

if aws lambda get-function --function-name oracle-pipeline-duval-mcp --region "$REGION" > /dev/null 2>&1; then
  signal_pass "Signal 8: Lambda oracle-pipeline-duval-mcp exists"
else
  signal_fail "Signal 8: Lambda oracle-pipeline-duval-mcp exists"
fi

# ── Signal 9: CloudFront distribution accessible ────────────────────────────
echo ""
echo "── CloudFront ──"
if [[ -n "$FRONTEND_URL" && "$FRONTEND_URL" != "None" ]]; then
  curl_check "$FRONTEND_URL" "200" "Signal 9: CloudFront frontend accessible"
else
  signal_fail "Signal 9: CloudFront frontend accessible (FrontendURL not available)"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo " Results: $PASS_COUNT passed, $FAIL_COUNT failed (9 total)"
echo "========================================="

if [ $FAIL_COUNT -gt 0 ]; then
  echo ""
  red "Failed signals:"
  for f in "${FAILURES[@]}"; do
    red "  - $f"
  done
  echo ""
  exit 1
fi

echo ""
green "All 9 signals passed!"
exit 0
