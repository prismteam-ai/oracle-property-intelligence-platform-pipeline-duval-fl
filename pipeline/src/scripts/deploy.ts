/**
 * Deploy script — push updated pipeline services to EC2.
 * T045 — Deploy command for the pipeline. Actual EC2 deployment is deferred
 * to Phase 8 (T070). This script validates the build and provides
 * deployment instructions.
 *
 * Usage: npm run deploy
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PIPELINE_ROOT = resolve(__dirname, '..', '..');

async function main(): Promise<void> {
  console.info('=== Oracle Pipeline Deploy ===');
  console.info('');

  // Step 1: Verify TypeScript compilation
  console.info('[deploy] Step 1: Type checking...');
  try {
    execSync('npx tsc --noEmit', { cwd: PIPELINE_ROOT, stdio: 'inherit' });
    console.info('[deploy] Type check passed');
  } catch {
    console.error('[deploy] Type check failed. Fix errors before deploying.');
    process.exit(1);
  }

  // Step 2: Build
  console.info('[deploy] Step 2: Building...');
  try {
    execSync('npx tsc', { cwd: PIPELINE_ROOT, stdio: 'inherit' });
    console.info('[deploy] Build complete');
  } catch {
    console.error('[deploy] Build failed.');
    process.exit(1);
  }

  // Step 3: Verify dist output exists
  const distDir = resolve(PIPELINE_ROOT, 'dist');
  if (!existsSync(distDir)) {
    console.error('[deploy] dist/ directory not found after build');
    process.exit(1);
  }
  console.info('[deploy] Step 3: dist/ directory verified');

  // Step 4: Print deployment instructions
  console.info('');
  console.info('=== Deployment Instructions ===');
  console.info('');
  console.info('The pipeline is built and ready for deployment.');
  console.info('To deploy to EC2, run the following on the target host:');
  console.info('');
  console.info('  1. Pull latest code:');
  console.info('     git pull origin feature/002-oracle-pipeline-duval');
  console.info('');
  console.info('  2. Install dependencies:');
  console.info('     cd pipeline && npm install');
  console.info('');
  console.info('  3. Rebuild:');
  console.info('     npm run build');
  console.info('');
  console.info('  4. Restart services via Docker Compose:');
  console.info('     cd .. && docker compose up -d --build');
  console.info('');
  console.info('  5. Verify pipeline health:');
  console.info('     npm run ingest -- --county duval --limit 5');
  console.info('');
  console.info('Or use CDK to redeploy the entire stack:');
  console.info('  cd infra && npx cdk deploy --all --require-approval never');
  console.info('');
  console.info('[deploy] Done. Actual EC2 deployment deferred to Phase 8 (T070).');
}

main().catch((err) => {
  console.error('[deploy] Fatal error:', err);
  process.exit(1);
});
