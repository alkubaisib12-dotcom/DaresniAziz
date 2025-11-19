/**
 * Study Buddy Panel - Main Chat Interface
 *
 * The primary component for interacting with the AI Study Buddy.
 * Features:
 * - Real-time streaming chat
 * - Quick action buttons (quiz, summary, revision plan)
 * - Tutor upsell suggestions
 * - Conversation history
 */

import React, { useState, useRef, useEffect } from "react";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { MessageCircle, X, Send, Menu, Sparkles } from "lucide-react";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import QuickActions from "./QuickActions";
import TutorUpsellBanner from "./TutorUpsellBanner";
import { useStudyBuddy } from "../../hooks/useStudyBuddy";
import { MessageDisplay } from "../../../../shared/studyBuddyTypes";

interface StudyBuddyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function StudyBuddyPanel({ isOpen, onClose }: StudyBuddyPanelProps) {
  const {
    messages,
    isStreaming,
    isLoading,
    error,
    currentConversationId,
    sendMessage,
    tutorSuggestion,
    dismissTutorSuggestion,
  } = useStudyBuddy();

  const [inputValue, setInputValue] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;

    const message = inputValue.trim();
    setInputValue("");

    await sendMessage(message);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickAction = async (action: string, params?: any) => {
    setShowQuickActions(false);

    switch (action) {
      case "quiz":
        setInputValue("Generate a quiz for me based on my recent progress");
        break;
      case "summary":
        setInputValue("Can you help me summarize my notes?");
        break;
      case "revision":
        setInputValue("Create a revision plan for my upcoming exam");
        break;
      case "progress":
        setInputValue("Show me my learning progress");
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 w-[400px] h-[600px] z-50 shadow-2xl animate-in slide-in-from-bottom-4">
      <Card className="h-full flex flex-col bg-white dark:bg-gray-900 border-2 border-primary/20">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-primary/10 to-blue-500/10">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Sparkles className="w-6 h-6 text-primary" />
              {isStreaming && (
                <span className="absolute -top-1 -right-1 w-3 h-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-lg">AI Study Buddy</h3>
              <p className="text-xs text-muted-foreground">
                {isStreaming ? "Thinking..." : "Ready to help"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowQuickActions(!showQuickActions)}
              title="Quick Actions"
            >
              <Menu className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Quick Actions Menu */}
        {showQuickActions && (
          <QuickActions onAction={handleQuickAction} onClose={() => setShowQuickActions(false)} />
        )}

        {/* Messages Area */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-4">
            {messages.length === 0 && !isLoading && (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="w-12 h-12 mx-auto mb-4 text-primary/50" />
                <h4 className="font-medium mb-2">Welcome to AI Study Buddy!</h4>
                <p className="text-sm">
                  I'm here to help you learn, practice, and improve.
                </p>
                <div className="mt-4 text-left max-w-sm mx-auto space-y-2 text-xs">
                  <p>Try asking me to:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Generate a practice quiz</li>
                    <li>Explain a concept</li>
                    <li>Create a study plan</li>
                    <li>Review your progress</li>
                  </ul>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <ChatMessage key={message.messageId} message={message} />
            ))}

            {isStreaming && messages.length > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce"></span>
                </div>
                <span>AI is typing...</span>
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-800 dark:text-red-200 text-sm">
                <p className="font-medium">Oops! Something went wrong</p>
                <p className="text-xs mt-1">{error}</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Tutor Upsell Banner */}
        {tutorSuggestion && (
          <TutorUpsellBanner
            suggestion={tutorSuggestion}
            onDismiss={dismissTutorSuggestion}
          />
        )}

        {/* Input Area */}
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSendMessage}
          onKeyPress={handleKeyPress}
          disabled={isStreaming}
          placeholder="Ask me anything about your studies..."
        />
      </Card>
    </div>
  );
}

/**
 * Floating Action Button to open Study Buddy
 */
export function StudyBuddyFAB() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-4 right-4 w-14 h-14 rounded-full shadow-lg hover:shadow-xl transition-all z-40"
          size="icon"
        >
          <MessageCircle className="w-6 h-6" />
        </Button>
      )}

      <StudyBuddyPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
