// src/hooks/useNotifications.ts
import { useQuery } from "@tanstack/react-query";
import { fetchNotifications, ApiNotification } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export function useNotifications() {
  const { user } = useAuth();
  const enabled = !!user?.id;

  const { data = [], isLoading, refetch } = useQuery<ApiNotification[]>({
    queryKey: ["notifications", user?.id],
    enabled,
    queryFn: fetchNotifications,
    refetchInterval: enabled ? 30000 : false, // Optimized: 30s instead of 10s
    staleTime: 20000, // Optimized: 20s instead of 5s
  });

  const unreadCount = data.filter((n) => !n.isRead).length;

  return { notifications: data, unreadCount, isLoading, refetch };
}
