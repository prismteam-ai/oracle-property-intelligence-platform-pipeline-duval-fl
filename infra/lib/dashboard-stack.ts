/**
 * CloudWatch Dashboard for Oracle Pipeline Duval FL.
 * Provides operational visibility into pipeline runs, ingestion, webhooks, and queries.
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type { Construct } from 'constructs';

const NAMESPACE = 'OraclePipeline/Duval';
const COUNTY_DIM = { county: 'duval' };

export class DashboardStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.dashboard = new cloudwatch.Dashboard(this, 'PipelineDashboard', {
      dashboardName: 'oracle-pipeline-duval',
      defaultInterval: cdk.Duration.hours(6),
    });

    // -------------------------------------------------------------------
    // Row 1: Pipeline Runs
    // -------------------------------------------------------------------

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Pipeline Run Count (Success vs Failure)',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'PipelineRunSuccess',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Success',
            color: '#2ca02c',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'PipelineRunFailure',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Failure',
            color: '#d62728',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Pipeline Run Duration',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'PipelineRunDuration',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'Avg Duration (ms)',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'PipelineRunDuration',
            dimensionsMap: COUNTY_DIM,
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
            label: 'p99 Duration (ms)',
          }),
        ],
      }),
    );

    // -------------------------------------------------------------------
    // Row 2: Source Ingestion
    // -------------------------------------------------------------------

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Records Ingested by Source',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'RecordsIngested',
            dimensionsMap: { ...COUNTY_DIM, source: 'county-appraiser' },
            statistic: 'Sum',
            period: cdk.Duration.minutes(15),
            label: 'County Appraiser',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'RecordsIngested',
            dimensionsMap: { ...COUNTY_DIM, source: 'county-clerk' },
            statistic: 'Sum',
            period: cdk.Duration.minutes(15),
            label: 'County Clerk',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Record Changes (New / Updated / Removed)',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'RecordsNew',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Sum',
            period: cdk.Duration.minutes(15),
            label: 'New',
            color: '#2ca02c',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'RecordsUpdated',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Sum',
            period: cdk.Duration.minutes(15),
            label: 'Updated',
            color: '#ff7f0e',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'RecordsRemoved',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Sum',
            period: cdk.Duration.minutes(15),
            label: 'Removed',
            color: '#d62728',
          }),
        ],
      }),
    );

    // -------------------------------------------------------------------
    // Row 3: Webhook Delivery
    // -------------------------------------------------------------------

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Webhook Delivery (Total vs Failures)',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'WebhookDeliveryTotal',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Total',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'WebhookDeliveryFailure',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            label: 'Failures',
            color: '#d62728',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Webhook Delivery Latency',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'WebhookDeliveryLatency',
            dimensionsMap: COUNTY_DIM,
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'Avg Latency (ms)',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'WebhookDeliveryLatency',
            dimensionsMap: COUNTY_DIM,
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
            label: 'p99 Latency (ms)',
          }),
        ],
      }),
    );

    // -------------------------------------------------------------------
    // Row 4: Agent Query Latency & Source Adapter Performance
    // -------------------------------------------------------------------

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Agent Query Latency',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'QueryDuration',
            dimensionsMap: { ...COUNTY_DIM, query_type: 'property-lookup' },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
            label: 'Property Lookup Avg (ms)',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'QueryDuration',
            dimensionsMap: { ...COUNTY_DIM, query_type: 'property-lookup' },
            statistic: 'p99',
            period: cdk.Duration.minutes(5),
            label: 'Property Lookup p99 (ms)',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'Source Adapter Duration',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'SourceAdapterDuration',
            dimensionsMap: { ...COUNTY_DIM, source: 'county-appraiser' },
            statistic: 'Average',
            period: cdk.Duration.minutes(15),
            label: 'County Appraiser Avg (ms)',
          }),
          new cloudwatch.Metric({
            namespace: NAMESPACE,
            metricName: 'SourceAdapterDuration',
            dimensionsMap: { ...COUNTY_DIM, source: 'county-clerk' },
            statistic: 'Average',
            period: cdk.Duration.minutes(15),
            label: 'County Clerk Avg (ms)',
          }),
        ],
      }),
    );

    // -------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=oracle-pipeline-duval`,
      description: 'CloudWatch Dashboard URL',
    });
  }
}
