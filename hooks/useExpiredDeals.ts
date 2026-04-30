import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export type ExpiredDeal = {
  id: string;
  name: string;
  value: number;
  owner: {
    id: string;
    name: string;
  };
  coOwner: {
    id: string;
    name: string;
  } | null;
  account: {
    name: string;
    district: string;
    state: string;
  };
  lastActivityAt: string;
  daysSinceLastActivity: number;
};

export function useExpiredDeals() {
  return useQuery({
    queryKey: ["expiredDeals"],
    queryFn: () => apiGet<ExpiredDeal[]>("/api/deals/expired"),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
