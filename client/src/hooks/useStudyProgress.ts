/**
 * useStudyProgress Hook
 *
 * Hook for fetching and tracking student progress
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProgressResponse } from "../../../shared/studyBuddyTypes";

interface UseStudyProgressReturn {
  progress: ProgressResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStudyProgress(subjectId?: string): UseStudyProgressReturn {
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = useQuery({
    queryKey: ["study-buddy-progress", subjectId],
    queryFn: async () => {
      const url = subjectId
        ? `/api/study-buddy/progress?subjectId=${subjectId}`
        : "/api/study-buddy/progress";

      const response = await fetch(url, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch progress");
      }

      const data: ProgressResponse = await response.json();
      return data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    if (queryError) {
      setError((queryError as Error).message || "Failed to fetch progress");
    }
  }, [queryError]);

  return {
    progress: data || null,
    isLoading,
    error,
    refetch: () => {
      refetch();
      setError(null);
    },
  };
}
