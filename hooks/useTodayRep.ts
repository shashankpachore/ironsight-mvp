import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export function useTodayRep<T = unknown>() {
  return useQuery({
    queryKey: ["today", "rep"],
    queryFn: () => apiGet<T>("/api/today"),
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
