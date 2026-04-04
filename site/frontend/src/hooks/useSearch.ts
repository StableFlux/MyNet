import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

interface SearchFilters {
  network_id?: number
  device_type_id?: number
  device_type_category?: string
  status?: string
  location?: string
  nic_type?: string
  exclude_in_service?: boolean
  exclude_stock?: boolean
  exclude_undeployed?: boolean
  exclude_decommissioned?: boolean
}

export function useSearch(query: string, filters: SearchFilters = {}) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  return useQuery({
    queryKey: ['search', debouncedQuery, filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (debouncedQuery) params.set('q', debouncedQuery)
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
      })
      const { data } = await api.get(`/search?${params}`)
      return data
    },
    enabled: true,
    refetchOnMount: 'always',
    placeholderData: (prev) => prev,
  })
}
