import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export function useToday<T = unknown>(repId?: string | null) {
  const url = repId ? `/api/today?repId=${encodeURIComponent(repId)}` : "/api/today";

  return useQuery({
    queryKey: ["today", repId ?? "all"],
    queryFn: () => apiGet<T>(url),
    enabled: repId !== null,
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
