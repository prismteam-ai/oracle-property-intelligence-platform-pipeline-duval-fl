/**
 * CDK stack for the Oracle Duval tRPC API: a single Node.js 22 Lambda behind an HTTP API v2.
 *
 * Region us-east-2 (soofi frontend guideline). The Lambda reads Neon + OpenSearch + Bedrock
 * server-side; the frontend never holds a secret. Notes carried from prior deploys:
 *  - the catch-all route is registered with EXPLICIT methods (GET, POST) — never `ANY` — so the
 *    CORS OPTIONS preflight is answered by the HTTP API CORS config, not forwarded to the Lambda.
 *  - Bedrock runs in us-east-1 (data region); IAM grants InvokeModel there via the SDK region env.
 */
import { App, Stack, StackProps, Duration, CfnOutput, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface ApiStackProps extends StackProps {
  /** ARN of the Secrets Manager secret holding DATABASE_URL / OPENSEARCH_* / API_ACCESS_TOKEN. */
  secretArn: string;
  /** Allowed browser origin (the Amplify app URL); '*' until the app URL is known. */
  allowedOrigin: string;
  /** Data region for Neon reads region hints + Bedrock (us-east-1). */
  dataRegion: string;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const secret = secretsmanager.Secret.fromSecretCompleteArn(this, "ApiSecret", props.secretArn);

    const fn = new lambda.Function(this, "TrpcFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(join(HERE, "..", "..", "dist")),
      memorySize: 1024,
      timeout: Duration.seconds(60),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        API_SECRET_ARN: props.secretArn,
        ALLOWED_ORIGIN: props.allowedOrigin,
        DATA_AWS_REGION: props.dataRegion,
        BEDROCK_REGION: props.dataRegion,
        NODE_OPTIONS: "--enable-source-maps",
      },
    });

    secret.grantRead(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${props.dataRegion}::foundation-model/*`,
          `arn:aws:bedrock:${props.dataRegion}:${this.account}:inference-profile/*`,
          `arn:aws:bedrock:*::foundation-model/*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }),
    );

    const integration = new HttpLambdaIntegration("TrpcIntegration", fn);
    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "oracle-duval-api",
      corsPreflight: {
        allowOrigins: props.allowedOrigin === "*" ? ["*"] : [props.allowedOrigin, "http://localhost:3000"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ["authorization", "content-type"],
        maxAge: Duration.hours(1),
      },
    });
    // Explicit methods only (no ANY, no OPTIONS route) so the preflight is served by CORS config.
    httpApi.addRoutes({ path: "/{proxy+}", methods: [HttpMethod.GET, HttpMethod.POST], integration });
    httpApi.addRoutes({ path: "/", methods: [HttpMethod.GET, HttpMethod.POST], integration });

    Tags.of(this).add("project", "oracle-duval");
    Tags.of(this).add("component", "api");

    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "FunctionName", { value: fn.functionName });
  }
}

const app = new App();
const secretArn = process.env.API_SECRET_ARN ?? app.node.tryGetContext("secretArn");
if (!secretArn) throw new Error("API_SECRET_ARN (or -c secretArn=...) is required");
new ApiStack(app, "OracleDuvalApiStack", {
  env: { region: process.env.CDK_REGION ?? "us-east-2", account: process.env.CDK_DEFAULT_ACCOUNT },
  secretArn,
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? app.node.tryGetContext("allowedOrigin") ?? "*",
  dataRegion: process.env.DATA_AWS_REGION ?? "us-east-1",
});
