import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from '@/components/layout/shell';

const DashboardPage = lazy(() => import('@/pages/dashboard'));
const PipelineRunsPage = lazy(() => import('@/pages/pipeline-runs'));
const PropertySearchPage = lazy(() => import('@/pages/property-search'));
const AgentChatPage = lazy(() => import('@/pages/agent-chat'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function PageLoader() {
  return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/pipeline-runs" element={<PipelineRunsPage />} />
              <Route path="/property-search" element={<PropertySearchPage />} />
              <Route path="/agent-chat" element={<AgentChatPage />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
