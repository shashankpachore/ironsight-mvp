import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { OutcomeValue } from "@/lib/domain";

export type InteractionLogItem = {
  id: string;
  outcome: OutcomeValue;
  createdAt: string;
  risks: string[];
};

export function useInteractionLogs(dealId: string | null | undefined) {
  return useQuery({
    queryKey: ["interactionLogs", dealId],
    queryFn: () => apiGet<InteractionLogItem[]>(`/api/logs/${dealId}`),
    enabled: Boolean(dealId),
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
