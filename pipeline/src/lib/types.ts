/**
 * Shared type definitions for the Oracle Pipeline.
 * Mirrors data-model.md entities.
 */

// ---------------------------------------------------------------------------
// Pipeline Run
// ---------------------------------------------------------------------------

export type PipelineRunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface PipelineRun {
  run_id: string;
  county: string;
  started_at: Date;
  completed_at: Date | null;
  status: PipelineRunStatus;
  record_count: number;
  delta_new: number;
  delta_updated: number;
  delta_removed: number;
  source_limitations: string[];
  published_artifact_cid: string | null;
  ipns_pointer: string | null;
}

// ---------------------------------------------------------------------------
// Data Source
// ---------------------------------------------------------------------------

export type SourceCategory = 'property' | 'permit' | 'ownership' | 'business' | 'contractor' | 'location';
export type CollectionMethod = 'browser-flow' | 'api' | 'bulk-download' | 'scrape';

export interface DataSource {
  source_id: string;
  name: string;
  category: SourceCategory;
  url: string;
  collection_method: CollectionMethod;
  last_successful_run: Date | null;
  record_count: number;
  limitations: string | null;
}

// ---------------------------------------------------------------------------
// Property Record (Lexicon-aligned)
// ---------------------------------------------------------------------------

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  unit?: string;
  full?: string;
}

export interface Owner {
  owner_name: string;
  mailing_address?: Address;
  owner_type?: string;
}

export interface OwnershipRecord {
  owner_name: string;
  transfer_date?: string;
  sale_price?: number;
  deed_type?: string;
  instrument_number?: string;
}

export interface Permit {
  permit_number?: string;
  permit_type?: string;
  issue_date?: string;
  description?: string;
  status?: string;
  contractor?: string;
  estimated_cost?: number;
}

export interface Structure {
  year_built?: number;
  sqft?: number;
  stories?: number;
  bedrooms?: number;
  bathrooms?: number;
  roof_type?: string;
  construction_type?: string;
  use_code?: string;
  use_description?: string;
}

export interface Lot {
  area_sqft?: number;
  area_acres?: number;
  dimensions?: string;
  zoning?: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Tax {
  assessed_value?: number;
  taxable_value?: number;
  tax_year?: number;
  annual_tax?: number;
  exemptions?: string[];
}

export interface Provenance {
  contributing_sources: string[];
  collection_timestamps: Record<string, string>;
  last_pipeline_run: string;
  source_artifact_uri?: string;
  reconciliation_confidence: number;
}

export interface DerivedSignals {
  roof_age_years?: number;
  ownership_tenure_years?: number;
  is_regional_owner?: boolean;
  water_proximity_ft?: number;
  is_waterfront?: boolean;
  transit_distance_mi?: number;
  starbucks_distance_mi?: number;
  within_walking_transit?: boolean;
  within_walking_starbucks?: boolean;
}

export interface PropertyRecord {
  uuid: string;
  parcel_id: string;
  address: Address;
  county_jurisdiction: string;
  assessed_value: number | null;
  market_value: number | null;
  ownership: OwnershipRecord[];
  current_owner: Owner | null;
  permits: Permit[];
  structure: Structure;
  lot: Lot;
  coordinates: Coordinates | null;
  tax: Tax;
  provenance: Provenance;
  derived_signals: DerivedSignals;
  content_hash?: string;
  created_at?: Date;
  updated_at?: Date;
}

// ---------------------------------------------------------------------------
// Run Sources (join)
// ---------------------------------------------------------------------------

export type RunSourceStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'skipped';

export interface RunSource {
  run_id: string;
  source_id: string;
  records_ingested: number;
  duration_ms: number | null;
  status: RunSourceStatus;
  limitations: string | null;
}

// ---------------------------------------------------------------------------
// Source Adapter Interface
// ---------------------------------------------------------------------------

export interface RawRecord {
  parcel_id: string;
  source_id: string;
  raw_data: Record<string, unknown>;
}

export interface SourceAdapter {
  source_id: string;
  /** Fetch raw records for a list of parcel IDs (or all if not provided). */
  fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]>;
}

// ---------------------------------------------------------------------------
// Transform Interface
// ---------------------------------------------------------------------------

export interface TransformResult {
  parcel_id: string;
  /** Partial property record fields to merge. */
  fields: Partial<PropertyRecord>;
}

export type TransformFn = (records: RawRecord[]) => TransformResult[];

// ---------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------

export interface DeltaCounts {
  new_count: number;
  updated_count: number;
  removed_count: number;
}

// ---------------------------------------------------------------------------
// Webhook Event (contract)
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  event_id: string;
  event_type: 'artifact.published';
  county: string;
  run_id: string;
  ipns_pointer: string;
  artifact_cid: string;
  timestamp: string;
  delta: {
    new_count: number;
    updated_count: number;
    removed_count: number;
    new_parcel_ids: string[];
    updated_parcel_ids: string[];
    removed_parcel_ids: string[];
  };
}
