/**
 * CloudWatch alarms and PagerDuty alerting via SNS.
 * T066 — Alarms for pipeline failures, stale IPNS, webhook failure rate, EC2 health.
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AlertingProps {
  /**
   * PagerDuty HTTPS endpoint for SNS integration.
   * Format: https://events.pagerduty.com/integration/<key>/enqueue
   * If not provided, falls back to constructing the endpoint from PAGERDUTY_INTEGRATION_KEY
   * env var or SSM parameter.
   */
  pagerDutyEndpoint?: string;

  /**
   * PagerDuty integration key (Events API v2).
   * If pagerDutyEndpoint is not set, the endpoint is constructed as:
   *   https://events.pagerduty.com/integration/<key>/enqueue
   * Can also be set via PAGERDUTY_INTEGRATION_KEY env var.
   */
  pagerDutyIntegrationKey?: string;

  /**
   * Email addresses to subscribe to the alert topic.
   */
  alertEmails?: string[];

  /**
   * EC2 instance ID for instance health alarms.
   */
  ec2InstanceId?: string;

  /**
   * SQS DLQ ARNs to monitor. Each gets a self-resolving alarm.
   */
  dlqArns?: string[];
}

// ---------------------------------------------------------------------------
// Alerting construct
// ---------------------------------------------------------------------------

export class AlertingStack extends cdk.Stack {
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: cdk.StackProps & AlertingProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------
    // SNS topic for all pipeline alerts
    // -------------------------------------------------------------------

    this.alertTopic = new sns.Topic(this, 'PipelineAlertTopic', {
      topicName: 'oracle-pipeline-duval-alerts',
      displayName: 'Oracle Pipeline Duval - Alerts',
    });

    // PagerDuty Events API v2 integration via HTTPS subscription
    const pdEndpoint = this.resolvePagerDutyEndpoint(props);
    if (pdEndpoint) {
      this.alertTopic.addSubscription(
        new sns_subscriptions.UrlSubscription(pdEndpoint, {
          protocol: sns.SubscriptionProtocol.HTTPS,
        }),
      );
    }

    // Email subscriptions
    for (const email of props?.alertEmails ?? []) {
      this.alertTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(email),
      );
    }

    const alarmAction = new cloudwatch_actions.SnsAction(this.alertTopic);

    // -------------------------------------------------------------------
    // Alarm 1: Pipeline run failure
    // Triggers when pipeline run failures exceed threshold.
    // Uses custom metric emitted via EMF structured logs.
    // -------------------------------------------------------------------

    const pipelineFailureMetric = new cloudwatch.Metric({
      namespace: 'OraclePipeline/Duval',
      metricName: 'PipelineRunFailure',
      dimensionsMap: { county: 'duval' },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const pipelineFailureAlarm = new cloudwatch.Alarm(this, 'PipelineRunFailureAlarm', {
      alarmName: 'oracle-pipeline-duval-run-failure',
      alarmDescription:
        'Pipeline run failed. Check CloudWatch logs for the oracle-pipeline service.',
      metric: pipelineFailureMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    pipelineFailureAlarm.addAlarmAction(alarmAction);
    pipelineFailureAlarm.addOkAction(alarmAction);

    // -------------------------------------------------------------------
    // Alarm 2: Stale IPNS pointer (no publish in 24h)
    // Triggers when no IPNS update has been recorded in 24 hours.
    // -------------------------------------------------------------------

    const ipnsPublishMetric = new cloudwatch.Metric({
      namespace: 'OraclePipeline/Duval',
      metricName: 'IpnsPublishSuccess',
      dimensionsMap: { county: 'duval' },
      statistic: 'Sum',
      period: cdk.Duration.hours(24),
    });

    const staleIpnsAlarm = new cloudwatch.Alarm(this, 'StaleIpnsAlarm', {
      alarmName: 'oracle-pipeline-duval-stale-ipns',
      alarmDescription:
        'IPNS pointer has not been updated in 24 hours. The pipeline may have stopped running.',
      metric: ipnsPublishMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });

    staleIpnsAlarm.addAlarmAction(alarmAction);
    staleIpnsAlarm.addOkAction(alarmAction);

    // -------------------------------------------------------------------
    // Alarm 3: Webhook delivery failure rate > 50%
    // -------------------------------------------------------------------

    const webhookFailMetric = new cloudwatch.Metric({
      namespace: 'OraclePipeline/Duval',
      metricName: 'WebhookDeliveryFailure',
      dimensionsMap: { county: 'duval' },
      statistic: 'Sum',
      period: cdk.Duration.minutes(15),
    });

    const webhookTotalMetric = new cloudwatch.Metric({
      namespace: 'OraclePipeline/Duval',
      metricName: 'WebhookDeliveryTotal',
      dimensionsMap: { county: 'duval' },
      statistic: 'Sum',
      period: cdk.Duration.minutes(15),
    });

    const webhookFailRateExpression = new cloudwatch.MathExpression({
      expression: 'IF(total > 0, (failures / total) * 100, 0)',
      usingMetrics: {
        failures: webhookFailMetric,
        total: webhookTotalMetric,
      },
      period: cdk.Duration.minutes(15),
    });

    const webhookFailAlarm = new cloudwatch.Alarm(this, 'WebhookFailureRateAlarm', {
      alarmName: 'oracle-pipeline-duval-webhook-failure-rate',
      alarmDescription:
        'Webhook delivery failure rate exceeds 50%. Check webhook endpoints and network connectivity.',
      metric: webhookFailRateExpression,
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    webhookFailAlarm.addAlarmAction(alarmAction);
    webhookFailAlarm.addOkAction(alarmAction);

    // -------------------------------------------------------------------
    // Alarm 4: EC2 instance health
    // Uses the built-in StatusCheckFailed metric.
    // -------------------------------------------------------------------

    if (props?.ec2InstanceId) {
      const ec2StatusMetric = new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed',
        dimensionsMap: { InstanceId: props.ec2InstanceId },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(5),
      });

      const ec2HealthAlarm = new cloudwatch.Alarm(this, 'EC2HealthAlarm', {
        alarmName: 'oracle-pipeline-duval-ec2-health',
        alarmDescription:
          'EC2 instance status check failed. The pipeline host may be down.',
        metric: ec2StatusMetric,
        threshold: 1,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });

      ec2HealthAlarm.addAlarmAction(alarmAction);
      ec2HealthAlarm.addOkAction(alarmAction);
    }

    // -------------------------------------------------------------------
    // Alarm 5: DLQ depth — self-resolving
    // Fires when messages land in any DLQ; auto-resolves when DLQ drains.
    // -------------------------------------------------------------------

    for (const [idx, dlqArn] of (props?.dlqArns ?? []).entries()) {
      const dlqQueue = sqs.Queue.fromQueueArn(this, `DlqRef${idx}`, dlqArn);

      const dlqMetric = dlqQueue.metricApproximateNumberOfMessagesVisible({
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      });

      const dlqAlarm = new cloudwatch.Alarm(this, `DlqDepthAlarm${idx}`, {
        alarmName: `oracle-pipeline-duval-dlq-depth-${idx}`,
        alarmDescription: `DLQ has messages waiting. Queue ARN: ${dlqArn}`,
        metric: dlqMetric,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      // Self-resolving: alarm fires on messages, OK action fires when drained
      dlqAlarm.addAlarmAction(alarmAction);
      dlqAlarm.addOkAction(alarmAction);
    }

    // -------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      description: 'SNS topic ARN for pipeline alerts',
    });

    if (pdEndpoint) {
      new cdk.CfnOutput(this, 'PagerDutyEndpoint', {
        value: pdEndpoint,
        description: 'PagerDuty Events API v2 HTTPS endpoint',
      });
    }
  }

  /**
   * Resolve PagerDuty Events API v2 endpoint from props or environment.
   * Priority: explicit endpoint > explicit key > env var PAGERDUTY_INTEGRATION_KEY.
   */
  private resolvePagerDutyEndpoint(props?: AlertingProps): string | undefined {
    if (props?.pagerDutyEndpoint) {
      return props.pagerDutyEndpoint;
    }

    const key =
      props?.pagerDutyIntegrationKey ??
      process.env.PAGERDUTY_INTEGRATION_KEY;

    if (key) {
      return `https://events.pagerduty.com/integration/${key}/enqueue`;
    }

    return undefined;
  }
}
