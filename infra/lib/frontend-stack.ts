import * as cdk from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

/**
 * FrontendStack provisions an Amplify-style static frontend deployment.
 *
 * Note: Since @aws-cdk/aws-amplify-alpha may not be available in all CDK versions,
 * this stack uses a CodeBuild + S3 + CloudFront pattern as a fallback.
 * When Amplify L2 construct stabilizes, migrate to that.
 */
export class FrontendStack extends cdk.Stack {
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for static frontend assets
    const websiteBucket = new cdk.aws_s3.Bucket(this, 'FrontendBucket', {
      bucketName: `oracle-pipeline-duval-frontend-${this.account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html', // SPA fallback
      publicReadAccess: false,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cdk.aws_cloudfront.OriginAccessIdentity(
      this,
      'FrontendOAI',
      {
        comment: 'Oracle Pipeline Duval Frontend OAI',
      },
    );

    websiteBucket.grantRead(originAccessIdentity);

    // API base URL — points to EC2 pipeline endpoint
    const apiBaseUrl = cdk.Fn.importValue('PipelineStack:PublicDNS');

    // CloudFront distribution
    const distribution = new cdk.aws_cloudfront.CloudFrontWebDistribution(
      this,
      'FrontendDistribution',
      {
        originConfigs: [
          {
            s3OriginSource: {
              s3BucketSource: websiteBucket,
              originAccessIdentity,
            },
            behaviors: [
              {
                isDefaultBehavior: true,
                viewerProtocolPolicy:
                  cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cdk.aws_cloudfront.CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
                cachedMethods: cdk.aws_cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
              },
            ],
          },
        ],
        errorConfigurations: [
          {
            errorCode: 404,
            responseCode: 200,
            responsePagePath: '/index.html',
            errorCachingMinTtl: 0,
          },
          {
            errorCode: 403,
            responseCode: 200,
            responsePagePath: '/index.html',
            errorCachingMinTtl: 0,
          },
        ],
        defaultRootObject: 'index.html',
        viewerProtocolPolicy: cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    );

    this.distributionDomainName = distribution.distributionDomainName;

    // CodeBuild project for frontend builds (triggered on push)
    const buildProject = new codebuild.Project(this, 'FrontendBuild', {
      projectName: 'oracle-pipeline-duval-frontend-build',
      description: 'Build and deploy Oracle Pipeline Duval frontend to S3/CloudFront',
      source: codebuild.Source.gitHub({
        owner: 'soofi-xyz',
        repo: 'oracle-property-intelligence-platform-pipeline-duval-fl',
        branchOrRef: 'main',
        webhook: true,
        webhookFilters: [
          codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andBranchIs('main'),
        ],
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        VITE_API_BASE_URL: {
          value: `https://${apiBaseUrl}`,
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        },
        S3_BUCKET: {
          value: websiteBucket.bucketName,
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        },
        DISTRIBUTION_ID: {
          value: distribution.distributionId,
          type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: '22',
            },
            commands: ['cd frontend', 'npm ci'],
          },
          build: {
            commands: ['npm run build'],
          },
          post_build: {
            commands: [
              'aws s3 sync dist/ s3://$S3_BUCKET/ --delete',
              'aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"',
            ],
          },
        },
        artifacts: {
          'base-directory': 'frontend/dist',
          files: ['**/*'],
        },
      }),
    });

    // Grant CodeBuild permissions to deploy
    websiteBucket.grantReadWrite(buildProject);
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    // Outputs
    new cdk.CfnOutput(this, 'FrontendURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Frontend CloudFront URL',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: websiteBucket.bucketName,
      description: 'Frontend S3 bucket name',
    });
  }
}
