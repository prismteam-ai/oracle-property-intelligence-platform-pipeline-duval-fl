# Bootstrap notes — Oracle ingestion infrastructure (us-east-1)

Reproducible steps to bring up the county-ingestion infrastructure that the pipeline
depends on: the main workflow stack, the permit-harvest stack, a seeds bucket, and the
Secrets Manager entries. Archive-only ingestion (no on-chain minting), so the blockchain
credentials are placeholders. Target region: **us-east-1**.

## Prerequisites

- An AWS profile with permission to deploy CloudFormation, and its **default region set to
  us-east-1**. SAM CLI derives the deploy region from the active profile's configured region,
  **not** from the `AWS_REGION` environment variable — if the profile's region differs from
  the target, SAM deploys to the wrong region. Set the profile region (or pass `--region`).
- Node 22, SAM CLI, esbuild (global), Docker running, AWS CLI, CDK, `jq`, `zip`.
- A checkout of the elephant repos in one workspace: `oracle-node` (with property-first
  ingest support), `elephant-query-db`, `Counties-trasform-scripts`, `lexicon`. Install the
  skills into the `oracle-node` checkout: `npx skills add elephant-xyz/skills --all -y`.
- A reachable Neon Postgres database URL, and Bedrock model access (Claude + a Titan/Cohere
  embedding model) in us-east-1.

## Steps

1. **Bootstrap CDK** in the target account/region (the account is otherwise empty there):

   ```bash
   cdk bootstrap "aws://<account>/us-east-1"
   ```

2. **Create an own, globally-unique seeds bucket** (do not reuse the default `counties-seeds`
   name). Block all public access.

   ```bash
   aws s3api create-bucket --bucket <unique-seeds-bucket> --region us-east-1
   aws s3api put-public-access-block --bucket <unique-seeds-bucket> \
     --public-access-block-configuration \
     BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   ```

3. **Store the Neon URL in Secrets Manager** and keep its ARN for the permit-harvest stack.
   The value is never printed or committed.

   ```bash
   aws secretsmanager create-secret --name <secret-name> \
     --secret-string "$DATABASE_URL" --query ARN --output text
   ```

   The secret name is arbitrary — it only has to match the ARN passed downstream as
   `QueryDatabaseUrlSecretArn`.

4. **Deploy the main workflow stack** via `oracle-node/scripts/deploy-infra.sh`. Environment
   used for archive-only ingestion:

   - `STACK_NAME=elephant-oracle-node`
   - `ELEPHANT_DOMAIN`, `ELEPHANT_API_KEY`, `ELEPHANT_ORACLE_KEY_ID`, `ELEPHANT_FROM_ADDRESS`,
     `ELEPHANT_RPC_URL`, `ELEPHANT_PINATA_JWT` = **placeholder values**. These are required by
     the deploy script and the template but unused at runtime for archive-only ingestion.
   - `GITHUB_TOKEN` = a real read-only PAT (see "Transform-scripts staging" below).
   - `TRANSFORM_S3_PREFIX_VALUE=s3://<unique-seeds-bucket>/transforms` — sets the required
     `TransformS3Prefix` parameter up front (see below).
   - `UPLOAD_TRANSFORMS` unset (defaults to false).
   - The deploy script pins `EmergencyStopEnabled=false` (budget kill switch off), so a daily
     budget alarm cannot disable event-source mappings mid-run.

   The script also deploys the companion `workflow-events`, `budget-alert`, and CodeBuild
   stacks, and builds one container-image function (mirror-validator) that bundles ML models —
   this is why it is packaged as an Image (see finding 3).

5. **Deploy the permit-harvest stack** (separate template; it is not deployed by
   `deploy-infra.sh`). It consumes the main stack's `EnvironmentBucketName` output; fetch it
   with:

   ```bash
   aws cloudformation describe-stacks --stack-name elephant-oracle-node \
     --query "Stacks[0].Outputs[?OutputKey=='EnvironmentBucketName'].OutputValue" --output text
   ```

   Package the permit-harvest worker (`npm install --omit=dev`, then zip;
   set `PUPPETEER_SKIP_DOWNLOAD=true` to skip the bundled Chromium), upload it under
   `deployments/permit-harvest-worker/<name>.zip` in that bucket, then:

   ```bash
   aws cloudformation deploy \
     --template-file permit-harvest/template.yaml \
     --stack-name elephant-permit-harvest \
     --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
     --no-fail-on-empty-changeset \
     --parameter-overrides \
       EnvironmentBucketName=<main stack EnvironmentBucketName output> \
       SourceSeedBucketName=<unique-seeds-bucket> \
       WorkerCodeS3Bucket=<main stack EnvironmentBucketName output> \
       WorkerCodeS3Key=deployments/permit-harvest-worker/<name>.zip \
       PermitHarvestOutputPrefix=permit-harvest \
       QueryDatabaseUrlSecretArn=<secret arn> \
       PermitHarvestMaximumConcurrency=2 \
       PropertyFirstPermitMaximumConcurrency=10
   ```

## Transform-scripts staging path (resolved)

Staging path used: **`UPLOAD_TRANSFORMS=false`** (the default). County transform scripts are
resolved from S3 at runtime; downstream county-onboarding stages stage the actual scripts.

A GitHub token secret **must exist regardless of the staging path**: the main template
materializes a Secrets Manager secret (`<stack-name>-github-token`) from a required
`GitHubToken` parameter that has no default, and the deploy script also creates/updates a
token secret. With `UPLOAD_TRANSFORMS=false` no GitHub push happens during deploy, so the
token only needs to exist and (optionally) authenticate reads — a read-only PAT is sufficient.

`TransformS3Prefix` is a required parameter with no default. On a first deploy the stack's
environment bucket does not exist yet, so the value is set explicitly (to an `s3://` URI under
the seeds bucket) to avoid a chicken-and-egg failure; it can be re-pointed later.

## Fresh-account findings (a first-time deployer will hit these)

1. **SQS visibility timeout vs Lambda timeout.** The main template ships ten SQS queues with
   `VisibilityTimeout: 331` while their consumer Lambdas have `Timeout: 900`. CloudFormation
   rejects the event-source mappings with *"Queue visibility timeout: 331 seconds is less than
   Function timeout: 900 seconds."* Fix: set those queues' visibility timeout to be at least
   the consumer function timeout (900). The template already does this for two queues
   ("Match Lambda timeout"); the rest were left at 331. Setting all of them to 900 is safe (the
   maximum Lambda timeout in the template is 900; a higher visibility on a dead-letter queue is
   harmless). 900 satisfies the hard CloudFormation constraint (visibility ≥ function timeout);
   AWS additionally recommends visibility be several multiples of the function timeout to avoid
   duplicate delivery under retry, which can be tuned up later without affecting the deploy.

2. **Lambda unzipped-size limit (250 MB) vs the CLI dependency tree.** Every zip-packaged
   function that depends on `@elephant-xyz/cli` installs the CLI's full dependency tree
   (headless-browser, AI/authoring, and blockchain libraries), pushing each package over the
   262,144,000-byte unzipped limit. CloudFormation fails with *"Unzipped size must be smaller
   than 262144000 bytes."* None of those subtrees are needed by every function's own runtime:
   the browser libraries are only used by the prepare/scrape functions, the blockchain library
   only by the submit functions, and the AI/authoring libraries by none at runtime (they back a
   local authoring command). Fix: after `sam build`, prune the unused subtrees per function
   class, then delete the resulting dangling `.bin` symlinks (the zip packager fails on broken
   symlinks). This brings every function comfortably under the limit.

3. **Container-image function for ML models.** The mirror-validator function is packaged as a
   container Image (not zip) specifically because its dependency downloads ML models that would
   exceed the zip limit. Leave it as Image; the first build downloads the models and can take a
   while, later builds reuse the Docker layer cache.

4. **Lambda memory ceiling on a fresh account.** The permit-harvest worker requests
   `MemorySize: 4096`, but a fresh account's per-function memory ceiling is 3008 MB, so the
   stack fails to create until the value is lowered (used 3008) or the account limit is raised.

## Verification (all passed)

- `describe-stacks`: `elephant-oracle-node` = **CREATE_COMPLETE**, `elephant-permit-harvest` =
  **CREATE_COMPLETE** (companion `workflow-events`, `budget-alert`, and CodeBuild stacks healthy).
- Neon reachability: `select 1` returns `1` (database `neondb`, PostgreSQL 18.4), connecting via
  the URL from Secrets Manager without printing it.
- Bedrock in us-east-1: a minimal `invoke-model` against a current Claude model returns text,
  and a Titan text-embedding model returns a 1024-dimension vector.
- Seeds bucket exists (public access blocked); the Neon URL secret exists and its ARN is wired
  into the permit-harvest stack as `QueryDatabaseUrlSecretArn`.
