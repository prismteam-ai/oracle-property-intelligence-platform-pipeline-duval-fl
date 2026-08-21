import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';

export interface AgentStackProps extends cdk.StackProps {
  pipelineSecurityGroup: ec2.SecurityGroup;
  vpc: ec2.IVpc;
}

export class AgentStack extends cdk.Stack {
  public readonly agentFunction: lambda.Function;
  public readonly mcpFunction: lambda.Function;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    // Shared IAM role for Lambda functions
    const lambdaRole = new iam.Role(this, 'AgentLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      description: 'IAM role for Oracle Pipeline agent and MCP Lambda functions',
    });

    // Allow access to Filebase via S3-compatible API (for DuckDB httpfs)
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:ListBucket', 's3:HeadObject'],
        resources: [
          'arn:aws:s3:::elephant-oracle-open-data-duval',
          'arn:aws:s3:::elephant-oracle-open-data-duval/*',
          'arn:aws:s3:::elephant-oracle-query-table-duval',
          'arn:aws:s3:::elephant-oracle-query-table-duval/*',
        ],
      }),
    );

    // Allow access to Secrets Manager for API keys
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
      }),
    );

    // Agent Lambda function — Vercel AI SDK + DuckDB
    this.agentFunction = new lambda.Function(this, 'AgentFunction', {
      functionName: 'oracle-pipeline-duval-agent',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../agent/dist', {
        // Placeholder — will be populated when agent code is built
      }),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      environment: {
        NODE_ENV: 'production',
        FILEBASE_ACCESS_KEY: '',
        FILEBASE_SECRET_KEY: '',
        ORACLE_OPEN_DATA_IPNS_MAP: JSON.stringify({
          duval: '', // Will be set after first publish
        }),
        ORACLE_QUERY_TABLE_IPNS_MAP: JSON.stringify({
          duval: '', // Will be set after first publish
        }),
      },
      description: 'Oracle Pipeline Duval — AI agent with DuckDB httpfs queries',
    });

    // MCP Lambda function — stateless, reads IPNS
    this.mcpFunction = new lambda.Function(this, 'MCPFunction', {
      functionName: 'oracle-pipeline-duval-mcp',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../mcp/dist', {
        // Placeholder — will be populated when MCP code is built
      }),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      environment: {
        NODE_ENV: 'production',
        ORACLE_OPEN_DATA_IPNS_MAP: JSON.stringify({
          duval: '', // Will be set after first publish
        }),
        ORACLE_QUERY_TABLE_IPNS_MAP: JSON.stringify({
          duval: '', // Will be set after first publish
        }),
      },
      description: 'Oracle Pipeline Duval — MCP server for external tool access',
    });

    // API Gateway
    this.api = new apigateway.RestApi(this, 'AgentApi', {
      restApiName: 'oracle-pipeline-duval-api',
      description: 'Oracle Pipeline Duval — Agent and MCP API Gateway',
      deployOptions: {
        stageName: 'v1',
        throttlingBurstLimit: 50,
        throttlingRateLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      },
    });

    // /agent route — proxy to Agent Lambda
    const agentResource = this.api.root.addResource('agent');
    const agentIntegration = new apigateway.LambdaIntegration(this.agentFunction, {
      proxy: true,
    });
    agentResource.addMethod('POST', agentIntegration);
    agentResource.addMethod('GET', agentIntegration); // health check

    // /agent/chat sub-route
    const chatResource = agentResource.addResource('chat');
    chatResource.addMethod('POST', agentIntegration);

    // /mcp route — proxy to MCP Lambda
    const mcpResource = this.api.root.addResource('mcp');
    const mcpIntegration = new apigateway.LambdaIntegration(this.mcpFunction, {
      proxy: true,
    });
    mcpResource.addMethod('POST', mcpIntegration);
    mcpResource.addMethod('GET', mcpIntegration); // health check

    // Outputs
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'API Gateway URL for agent and MCP endpoints',
    });

    new cdk.CfnOutput(this, 'AgentEndpoint', {
      value: `${this.api.url}agent`,
      description: 'Agent endpoint URL',
    });

    new cdk.CfnOutput(this, 'MCPEndpoint', {
      value: `${this.api.url}mcp`,
      description: 'MCP endpoint URL',
    });
  }
}
