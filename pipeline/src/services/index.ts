/**
 * Restate service registration — entry point for all pipeline services.
 * T026 — Register all Restate virtual objects and services with the runtime.
 */

import * as restate from '@restatedev/restate-sdk';
import { loaderObject } from './loader.js';
import { parcelObject } from './parcel.js';

// ---------------------------------------------------------------------------
// Create Restate endpoint with all services
// ---------------------------------------------------------------------------

const endpoint = restate.endpoint();

// Register virtual objects
endpoint.bind(loaderObject);
endpoint.bind(parcelObject);

// Start the Restate HTTP server
const RESTATE_PORT = parseInt(process.env.RESTATE_SERVICE_PORT ?? '9080', 10);

endpoint.listen(RESTATE_PORT);
console.info(`[restate] Pipeline services listening on port ${RESTATE_PORT}`);
console.info('[restate] Registered services: loader, parcel');

export { endpoint };
