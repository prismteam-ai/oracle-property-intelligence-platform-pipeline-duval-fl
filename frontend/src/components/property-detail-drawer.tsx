/**
 * Property Detail Drawer — slide-out panel with all attributes + source provenance.
 * T055 — Shows full property details when a row is clicked in Property Search.
 */

import React, { useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PropertyDetail {
  uuid: string;
  parcel_id: string;
  address: {
    full?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  county_jurisdiction: string;
  assessed_value: number | null;
  market_value: number | null;
  current_owner: {
    owner_name?: string;
    mailing_address?: { full?: string; city?: string; state?: string };
  } | null;
  structure: {
    year_built?: number;
    sqft?: number;
    stories?: number;
    bedrooms?: number;
    bathrooms?: number;
    roof_type?: string;
  } | null;
  derived_signals: {
    roof_age_years?: number;
    ownership_tenure_years?: number;
    is_regional_owner?: boolean;
    water_proximity_ft?: number;
    is_waterfront?: boolean;
    transit_distance_mi?: number;
    starbucks_distance_mi?: number;
    within_walking_transit?: boolean;
    within_walking_starbucks?: boolean;
  } | null;
  provenance: {
    contributing_sources?: string[];
    collection_timestamps?: Record<string, string>;
    last_pipeline_run?: string;
    reconciliation_confidence?: number;
  } | null;
  ownership: Array<{
    owner_name?: string;
    transfer_date?: string;
    sale_price?: number;
  }> | null;
  updated_at: string | null;
}

interface Props {
  parcelId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchPropertyDetail(parcelId: string): Promise<PropertyDetail> {
  const res = await fetch(`/api/properties/${encodeURIComponent(parcelId)}`);
  if (!res.ok) throw new Error(`Failed to load property: ${res.status}`);
  const data = await res.json();
  return data.property;
}

// ---------------------------------------------------------------------------
// Helper: format currency
// ---------------------------------------------------------------------------

function formatCurrency(val: number | null | undefined): string {
  if (val == null) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PropertyDetailDrawer({ parcelId, onClose }: Props) {
  const { data: property, isLoading, error } = useQuery({
    queryKey: ['property-detail', parcelId],
    queryFn: () => fetchPropertyDetail(parcelId),
  });

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const signals = property?.derived_signals;
  const prov = property?.provenance;
  const lastSale = property?.ownership?.length
    ? property.ownership[property.ownership.length - 1]
    : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-background border-l shadow-xl z-50 overflow-y-auto animate-in slide-in-from-right">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">
              {property?.parcel_id ?? parcelId}
            </h2>
            {property?.address?.full && (
              <p className="text-sm text-muted-foreground">{property.address.full}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {isLoading && (
            <div className="text-center py-8 text-muted-foreground">Loading property details...</div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              {String(error)}
            </div>
          )}

          {property && (
            <>
              {/* Property attributes */}
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Property Details
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <DetailRow label="Assessed Value" value={formatCurrency(property.assessed_value)} />
                  <DetailRow label="Market Value" value={formatCurrency(property.market_value)} />
                  <DetailRow label="Year Built" value={property.structure?.year_built?.toString() ?? 'N/A'} />
                  <DetailRow label="Sqft" value={property.structure?.sqft?.toLocaleString() ?? 'N/A'} />
                  <DetailRow label="Owner" value={property.current_owner?.owner_name ?? 'N/A'} />
                  <DetailRow label="Roof Type" value={property.structure?.roof_type ?? 'N/A'} />
                </div>
              </section>

              {/* Derived signals */}
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Intelligence Signals
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <DetailRow
                    label="Roof Age"
                    value={signals?.roof_age_years != null ? `${signals.roof_age_years} years` : 'N/A'}
                  />
                  <DetailRow
                    label="Ownership Tenure"
                    value={signals?.ownership_tenure_years != null ? `${signals.ownership_tenure_years} years` : 'N/A'}
                  />
                  <DetailRow label="Last Sale" value={formatDate(lastSale?.transfer_date)} />
                  <DetailRow
                    label="Regional Owner"
                    value={
                      signals?.is_regional_owner != null
                        ? signals.is_regional_owner
                          ? 'Yes (out-of-area)'
                          : 'No (local)'
                        : 'N/A'
                    }
                  />
                  <DetailRow
                    label="Water Proximity"
                    value={
                      signals?.water_proximity_ft != null
                        ? `${signals.water_proximity_ft.toLocaleString()} ft`
                        : 'N/A'
                    }
                  />
                  <DetailRow
                    label="Transit Distance"
                    value={signals?.transit_distance_mi != null ? `${signals.transit_distance_mi} mi` : 'N/A'}
                  />
                  <DetailRow
                    label="Starbucks Distance"
                    value={signals?.starbucks_distance_mi != null ? `${signals.starbucks_distance_mi} mi` : 'N/A'}
                  />
                  <DetailRow
                    label="Waterfront"
                    value={signals?.is_waterfront != null ? (signals.is_waterfront ? 'Yes' : 'No') : 'N/A'}
                  />
                </div>
              </section>

              {/* Source provenance */}
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Source Provenance
                </h3>
                {prov?.contributing_sources && prov.contributing_sources.length > 0 ? (
                  <div className="space-y-2">
                    {prov.contributing_sources.map((source) => (
                      <div
                        key={source}
                        className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                          <span className="font-medium">{source}</span>
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {prov.collection_timestamps?.[source]
                            ? `collected ${formatDate(prov.collection_timestamps[source])}`
                            : ''}
                          {prov.last_pipeline_run && (
                            <span className="ml-2">Run {prov.last_pipeline_run}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No provenance data available</p>
                )}

                {prov?.reconciliation_confidence != null && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    Reconciliation confidence:{' '}
                    <span className="font-medium text-foreground">
                      {(prov.reconciliation_confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export default PropertyDetailDrawer;
