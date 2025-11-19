/**
 * useStudyBuddy Hook
 *
 * Main hook for managing Study Buddy chat functionality with streaming support
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../components/AuthProvider";
import {
  MessageDisplay,
  ChatStreamEvent,
  TutorUpsellSuggestion,
  StudyBuddyMessage,
} from "../../../shared/studyBuddyTypes";

interface UseStudyBuddyReturn {
  messages: MessageDisplay[];
  isStreaming: boolean;
  isLoading: boolean;
  error: string | null;
  currentConversationId: string | null;
  sendMessage: (message: string) => Promise<void>;
  tutorSuggestion: TutorUpsellSuggestion | null;
  dismissTutorSuggestion: () => void;
  loadConversation: (conversationId: string) => Promise<void>;
  newConversation: () => void;
}

export function useStudyBuddy(): UseStudyBuddyReturn {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageDisplay[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [tutorSuggestion, setTutorSuggestion] = useState<TutorUpsellSuggestion | null>(null);

  const streamingMessageRef = useRef<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Send a message and handle streaming response
   */
  const sendMessage = useCallback(
    async (message: string) => {
      if (!user || !message.trim()) return;

      setError(null);

      // Add user message immediately
      const userMessage: MessageDisplay = {
        messageId: `temp_${Date.now()}`,
        conversationId: currentConversationId || "",
        userId: user.id,
        role: "user",
        content: message,
        timestamp: new Date() as any,
        displayTime: formatTime(new Date()),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Start streaming
      setIsStreaming(true);
      streamingMessageRef.current = "";

      // Create abort controller for cleanup
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch("/api/study-buddy/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            message,
            conversationId: currentConversationId,
            includeContext: true,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to send message");
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        // Process SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let assistantMessageId = `temp_assistant_${Date.now()}`;

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data: ChatStreamEvent = JSON.parse(line.substring(6));

                switch (data.type) {
                  case "token":
                    streamingMessageRef.current += data.content || "";

                    // Update or add streaming message
                    setMessages((prev) => {
                      const exists = prev.find((m) => m.messageId === assistantMessageId);

                      if (exists) {
                        return prev.map((m) =>
                          m.messageId === assistantMessageId
                            ? {
                                ...m,
                                content: streamingMessageRef.current,
                                isStreaming: true,
                              }
                            : m
                        );
                      } else {
                        // Add new assistant message
                        return [
                          ...prev,
                          {
                            messageId: assistantMessageId,
                            conversationId: currentConversationId || "",
                            userId: user.id,
                            role: "assistant" as const,
                            content: streamingMessageRef.current,
                            timestamp: new Date() as any,
                            displayTime: formatTime(new Date()),
                            isStreaming: true,
                          },
                        ];
                      }
                    });
                    break;

                  case "complete":
                    // Mark message as complete
                    if (data.messageId) {
                      assistantMessageId = data.messageId;
                    }
                    if (data.conversationId && !currentConversationId) {
                      setCurrentConversationId(data.conversationId);
                    }

                    setMessages((prev) =>
                      prev.map((m) =>
                        m.messageId === assistantMessageId
                          ? { ...m, isStreaming: false, messageId: data.messageId || m.messageId }
                          : m
                      )
                    );

                    setIsStreaming(false);
                    streamingMessageRef.current = "";
                    break;

                  case "upsell":
                    if (data.suggestion) {
                      setTutorSuggestion(data.suggestion);
                    }
                    break;

                  case "error":
                    setError(data.error || "An error occurred");
                    setIsStreaming(false);
                    break;

                  case "action":
                    // Handle special actions (future feature)
                    console.log("Action received:", data.action);
                    break;
                }
              } catch (e) {
                console.error("Error parsing SSE data:", e);
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          // Request was aborted
          return;
        }

        console.error("Error sending message:", err);
        setError(err.message || "Failed to send message");
        setIsStreaming(false);
      }
    },
    [user, currentConversationId]
  );

  /**
   * Load an existing conversation
   */
  const loadConversation = useCallback(async (conversationId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/study-buddy/conversations/${conversationId}/messages`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to load conversation");
      }

      const data: StudyBuddyMessage[] = await response.json();

      const displayMessages: MessageDisplay[] = data.map((msg) => ({
        ...msg,
        displayTime: formatTime(msg.timestamp.toDate?.() || new Date()),
      }));

      setMessages(displayMessages);
      setCurrentConversationId(conversationId);
    } catch (err: any) {
      console.error("Error loading conversation:", err);
      setError(err.message || "Failed to load conversation");
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Start a new conversation
   */
  const newConversation = useCallback(() => {
    setMessages([]);
    setCurrentConversationId(null);
    setTutorSuggestion(null);
    setError(null);
  }, []);

  /**
   * Dismiss tutor suggestion
   */
  const dismissTutorSuggestion = useCallback(() => {
    setTutorSuggestion(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    messages,
    isStreaming,
    isLoading,
    error,
    currentConversationId,
    sendMessage,
    tutorSuggestion,
    dismissTutorSuggestion,
    loadConversation,
    newConversation,
  };
}

/**
 * Format timestamp for display
 */
function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than 1 minute
  if (diff < 60000) {
    return "Just now";
  }

  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Format as time
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
