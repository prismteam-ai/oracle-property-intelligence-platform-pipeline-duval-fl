/**
 * Typed API client + TanStack Query hooks — T049
 * All endpoints proxied via vite dev server to pipeline :9080.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types (mirror pipeline API responses)
// ---------------------------------------------------------------------------

export type PipelineRunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface StatsResponse {
  totalProperties: number;
  lastRun: {
    run_id: string;
    started_at: string;
    status: PipelineRunStatus;
    delta_new: number;
    delta_updated: number;
    delta_removed: number;
  } | null;
  ipnsStatus: 'live' | 'stale' | 'pending';
  ipnsPointer: string | null;
  artifactCid: string | null;
  sourceCount: number;
  healthySources: number;
}

export interface RunListItem {
  run_id: string;
  county: string;
  started_at: string;
  completed_at: string | null;
  status: PipelineRunStatus;
  record_count: number;
  delta_new: number;
  delta_updated: number;
  delta_removed: number;
  source_limitations: string[];
  published_artifact_cid: string | null;
  ipns_pointer: string | null;
}

export interface RunSourceDetail {
  source_id: string;
  source_name: string;
  records_ingested: number;
  duration_ms: number | null;
  status: string;
  limitations: string | null;
}

export interface RunDetail extends RunListItem {
  sources: RunSourceDetail[];
}

export interface RunsResponse {
  runs: RunListItem[];
  total: number;
  page: number;
  limit: number;
}

export type SourceStatus = 'healthy' | 'slow' | 'stale' | 'error';

export interface SourceListItem {
  source_id: string;
  name: string;
  category: string;
  url: string;
  collection_method: string;
  last_successful_run: string | null;
  record_count: number;
  limitations: string | null;
  status: SourceStatus;
}

export interface SourcesResponse {
  sources: SourceListItem[];
}

export interface TriggerRunResponse {
  run_id: string;
  county: string;
  status: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Raw API calls
// ---------------------------------------------------------------------------

export const api = {
  getStats: () => apiFetch<StatsResponse>('/api/stats'),
  getRuns: (page = 1, limit = 20) =>
    apiFetch<RunsResponse>(`/api/runs?page=${page}&limit=${limit}`),
  getRun: (id: string) => apiFetch<RunDetail>(`/api/runs/${id}`),
  getSources: () => apiFetch<SourcesResponse>('/api/sources'),
  triggerRun: (county = 'duval') =>
    apiFetch<TriggerRunResponse>('/api/runs/trigger', {
      method: 'POST',
      body: JSON.stringify({ county }),
    }),
};

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    refetchInterval: 30_000,
  });
}

export function useRuns(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['runs', page, limit],
    queryFn: () => api.getRuns(page, limit),
    refetchInterval: 15_000,
  });
}

export function useRun(id: string | null) {
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => api.getRun(id!),
    enabled: !!id,
  });
}

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: api.getSources,
    refetchInterval: 60_000,
  });
}

export function useTriggerRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (county?: string) => api.triggerRun(county),
    onSuccess: () => {
      // Invalidate runs and stats queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
