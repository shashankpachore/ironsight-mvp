import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export function useManagerInsights<T = unknown>(enabled = true) {
  return useQuery({
    queryKey: ["managerInsights"],
    queryFn: () => apiGet<T>("/api/manager/insights"),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
