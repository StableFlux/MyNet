import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { applyTheme, type ThemeMode } from './store/themeStore'

// Apply theme before first render to prevent flash of wrong theme
try {
  const stored = JSON.parse(localStorage.getItem('mynet-theme') ?? '{}')
  applyTheme((stored?.state?.mode as ThemeMode) ?? 'dark')
} catch {
  applyTheme('dark')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
