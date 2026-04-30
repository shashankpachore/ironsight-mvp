import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export type DealDetail = {
  id: string;
  ownerId: string;
  coOwnerId?: string | null;
  owner?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  coOwner?: {
    id: string;
    name: string;
  } | null;
  expiryWarning?: "EXPIRED" | "EXPIRING_SOON" | null;
  daysToExpiry?: number | null;
};

export function useDeal(id: string | null | undefined) {
  return useQuery({
    queryKey: ["deal", id],
    queryFn: () => apiGet<DealDetail>(`/api/deals/${id}?includeLogs=false`),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
