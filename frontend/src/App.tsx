import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {/* Pages will be added in Phase 5 (US3) */}
          <Route path="/dashboard" element={<div>Dashboard — coming soon</div>} />
          <Route path="/pipeline-runs" element={<div>Pipeline Runs — coming soon</div>} />
          <Route path="/property-search" element={<div>Property Search — coming soon</div>} />
          <Route path="/agent-chat" element={<div>Agent Chat — coming soon</div>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
