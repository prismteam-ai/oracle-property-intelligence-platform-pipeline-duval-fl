#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack.js';
import { FrontendStack } from '../lib/frontend-stack.js';
import { AgentStack } from '../lib/agent-stack.js';
import { AlertingStack } from '../lib/alerting.js';
import { DashboardStack } from '../lib/dashboard-stack.js';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-2',
};

const pipelineStack = new PipelineStack(app, 'PipelineStack', {
  env,
  description: 'Oracle Pipeline Duval FL — EC2 + Docker Compose (Restate + Postgres)',
});

const frontendStack = new FrontendStack(app, 'FrontendStack', {
  env,
  description: 'Oracle Pipeline Duval FL — Amplify React frontend',
});

const agentStack = new AgentStack(app, 'AgentStack', {
  env,
  description: 'Oracle Pipeline Duval FL — Lambda agent + MCP endpoints',
  pipelineSecurityGroup: pipelineStack.securityGroup,
  vpc: pipelineStack.vpc,
});

const alertingStack = new AlertingStack(app, 'AlertingStack', {
  env,
  description: 'Oracle Pipeline Duval FL — CloudWatch alarms + PagerDuty alerting',
  ec2InstanceId: pipelineStack.instance.instanceId,
});

const dashboardStack = new DashboardStack(app, 'DashboardStack', {
  env,
  description: 'Oracle Pipeline Duval FL — CloudWatch operational dashboard',
});

// Tag all resources
cdk.Tags.of(app).add('Project', 'oracle-pipeline-duval-fl');
cdk.Tags.of(app).add('Environment', 'production');
cdk.Tags.of(app).add('ManagedBy', 'cdk');
