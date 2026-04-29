import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export function useManagerTodayFull<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: ["today", "managerFull"],
    queryFn: () => apiGet<T>("/api/today/manager-full"),
    enabled,
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
