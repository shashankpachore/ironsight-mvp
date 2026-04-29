import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

type UsePipelineOptions = {
  product?: string;
  enabled?: boolean;
};

export function getPipelineUrl(product = "") {
  const params = new URLSearchParams({
    includeRepBreakdown: "1",
    includeOutcomes: "1",
  });
  if (product) params.set("product", product);
  return `/api/pipeline?${params.toString()}`;
}

export function getPipelineQueryKey(product = "") {
  return ["pipeline", product] as const;
}

export function usePipeline({ product = "", enabled = false }: UsePipelineOptions = {}) {
  const url = getPipelineUrl(product);

  return useQuery({
    queryKey: getPipelineQueryKey(product),
    queryFn: () => apiGet(url),
    enabled,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
