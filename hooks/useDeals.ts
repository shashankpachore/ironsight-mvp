import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export function useDeals(url = "/api/deals") {
  return useQuery({
    queryKey: ["deals", url],
    queryFn: () => apiGet(url),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
