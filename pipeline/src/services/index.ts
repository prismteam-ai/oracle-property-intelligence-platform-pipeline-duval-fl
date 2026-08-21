/**
 * Restate service registration — entry point for all pipeline services.
 * T026 — Register all Restate virtual objects and services with the runtime.
 * T029/T030 — Register county-ingest and ingest-chunk workflows.
 */

import * as restate from '@restatedev/restate-sdk';
import { loaderObject } from './loader.js';
import { parcelObject } from './parcel.js';
import { countyIngestWorkflow } from '../workflows/county-ingest.js';
import { ingestChunkWorkflow } from '../workflows/ingest-chunk.js';

// ---------------------------------------------------------------------------
// Create Restate endpoint with all services
// ---------------------------------------------------------------------------

const endpoint = restate.endpoint();

// Register virtual objects
endpoint.bind(loaderObject);
endpoint.bind(parcelObject);

// Register workflows
endpoint.bind(countyIngestWorkflow);
endpoint.bind(ingestChunkWorkflow);

// Start the Restate HTTP server
const RESTATE_PORT = parseInt(process.env.RESTATE_SERVICE_PORT ?? '9080', 10);

endpoint.listen(RESTATE_PORT);
console.info(`[restate] Pipeline services listening on port ${RESTATE_PORT}`);
console.info('[restate] Registered services: loader, parcel, county-ingest, ingest-chunk');

export { endpoint };
