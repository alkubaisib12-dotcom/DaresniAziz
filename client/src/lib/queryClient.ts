import { QueryClient } from "@tanstack/react-query";

// Default fetcher for React Query that includes error handling
export async function apiRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let errorMessage = `${response.status}: ${response.statusText}`;
    
    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = `${response.status}: ${errorData.message}`;
      }
    } catch {
      // Fallback to status text if JSON parsing fails
    }
    
    throw new Error(errorMessage);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return null;
  }
  
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Default query function for GET requests
async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }) {
  const url = queryKey[0] as string;
  return apiRequest(url);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry on auth errors (401, 403)
        if (error.message.includes('401') || error.message.includes('403')) {
          return false;
        }
        return failureCount < 3;
      },
    },
  },
});
