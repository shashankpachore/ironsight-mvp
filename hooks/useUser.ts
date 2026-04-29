import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

type CurrentUser = {
  id: string;
  email: string;
  role: string;
};

export function useUser() {
  return useQuery({
    queryKey: ["user"],
    queryFn: () => apiGet<CurrentUser>("/api/session/me"),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
