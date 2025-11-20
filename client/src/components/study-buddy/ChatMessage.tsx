/**
 * Chat Message Component
 *
 * Displays individual messages with proper styling for user/assistant roles
 */

import React from "react";
import { cn } from "../../lib/utils";
import { MessageDisplay } from "../../../../shared/studyBuddyTypes";
import { Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface ChatMessageProps {
  message: MessageDisplay;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn(
        "flex gap-3 group",
        isUser && "flex-row-reverse"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white",
          isUser ? "bg-blue-500" : "bg-gradient-to-br from-purple-500 to-pink-500"
        )}
      >
        {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>

      {/* Message Content */}
      <div
        className={cn(
          "flex-1 max-w-[80%]",
          isUser && "flex justify-end"
        )}
      >
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            isUser
              ? "bg-blue-500 text-white"
              : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          )}
        >
          {isAssistant ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  // Customize markdown rendering
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                  code: ({ inline, children, ...props }: any) =>
                    inline ? (
                      <code className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs font-mono">
                        {children}
                      </code>
                    ) : (
                      <code
                        className="block bg-gray-200 dark:bg-gray-700 p-2 rounded text-xs font-mono overflow-x-auto"
                        {...props}
                      >
                        {children}
                      </code>
                    ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}

          {/* Timestamp */}
          <div
            className={cn(
              "text-xs mt-1 opacity-70",
              isUser ? "text-blue-100" : "text-gray-500 dark:text-gray-400"
            )}
          >
            {message.displayTime}
          </div>
        </div>

        {/* Error indicator */}
        {message.error && (
          <div className="text-xs text-red-500 mt-1">Failed to send</div>
        )}
      </div>
    </div>
  );
}
