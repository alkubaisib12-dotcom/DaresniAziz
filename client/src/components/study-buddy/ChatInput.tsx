/**
 * Chat Input Component
 *
 * Text input area with send button
 */

import React from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Send } from "lucide-react";
import { cn } from "../../lib/utils";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onKeyPress,
  disabled = false,
  placeholder = "Type your message...",
}: ChatInputProps) {
  return (
    <div className="border-t p-4 bg-gray-50 dark:bg-gray-900/50">
      <div className="flex gap-2 items-end">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyPress}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "flex-1 min-h-[80px] max-h-[120px] resize-none",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        />
        <Button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          size="icon"
          className="h-10 w-10"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
