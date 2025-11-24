import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface ChatWindowProps {
  userId: string; // other participant (student or tutor)
  onClose: () => void;
}

type ChatUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

type ChatMessage = {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  read: boolean;
  createdAt: string;
  sender?: ChatUser | null;
  receiver?: ChatUser | null;
};

export function ChatWindow({ userId, onClose }: ChatWindowProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [newMessage, setNewMessage] = useState("");
  const [hasMarkedRead, setHasMarkedRead] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch full conversation with this user
  const {
    data: messages,
    isLoading,
  } = useQuery<ChatMessage[]>({
    queryKey: ["/api/messages", userId],
    queryFn: () => apiRequest(`/api/messages/${userId}`),
    refetchInterval: 15000, // Optimized: 15s instead of 5s for chat
    staleTime: 10000, // Cache for 10s
  });

  // Fetch the "other" user for header
  const { data: otherUser } = useQuery<ChatUser>({
    queryKey: ["/api/users", userId],
    queryFn: () => apiRequest(`/api/users/${userId}`),
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      return await apiRequest("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          receiverId: userId,
          content,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", userId] });
      setNewMessage("");
    },
    onError: (error: any) => {
      // Handle blocked messages with specific error messages
      const errorMessage = error?.message || "Failed to send message";
      const isBlocked = error?.blocked === true;

      toast({
        title: isBlocked ? "⚠️ Message Blocked" : "Error",
        description: errorMessage,
        variant: "destructive",
        duration: isBlocked ? 7000 : 5000, // Show blocked messages longer
      });

      // Don't clear the message input if it was blocked, so user can edit it
      // Message will remain in the input field for user to modify
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/messages/read/${userId}`, {
        method: "PUT",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages", userId] });
    },
  });

  // Scroll to bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setHasMarkedRead(false);
  }, [userId]);

  // Mark as read once when messages load
  useEffect(() => {
    if (!hasMarkedRead && messages && messages.length > 0) {
      markAsReadMutation.mutate();
      setHasMarkedRead(true);
    }
  }, [messages, hasMarkedRead, markAsReadMutation]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newMessage.trim();
    if (!trimmed) return;
    sendMessageMutation.mutate(trimmed);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  return (
    <div
      className="fixed bottom-4 right-4 w-80 h-[600px] z-50 flex flex-col"
      data-testid="chat-window"
    >
      {/* IMPORTANT: make Card a flex column so footer stays visible */}
      <Card className="h-full shadow-xl flex flex-col overflow-hidden">
        <CardHeader className="p-4 bg-primary text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Avatar className="w-8 h-8">
                <AvatarImage src={otherUser?.profileImageUrl || undefined} />
                <AvatarFallback className="bg-white/20 text-white text-sm">
                  {otherUser?.firstName?.[0]}
                  {otherUser?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-sm">
                  {otherUser?.firstName} {otherUser?.lastName}
                </CardTitle>
                <div className="flex items-center space-x-1">
                  <div className="w-2 h-2 bg-green-400 rounded-full" />
                  <span className="text-xs opacity-90">Online</span>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/20 h-8 w-8 p-0"
              onClick={onClose}
              data-testid="button-close-chat"
            >
              <i className="fas fa-times" />
            </Button>
          </div>
        </CardHeader>

        {/* IMPORTANT: CardContent is flex-1 column; ScrollArea flex-1; input fixed at bottom */}
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          {/* Messages */}
          <ScrollArea className="flex-1 px-4 pt-4 pb-2 min-h-0">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="flex space-x-2">
                      <div className="w-8 h-8 bg-muted rounded-full" />
                      <div className="flex-1">
                        <div className="h-4 bg-muted rounded w-3/4 mb-1" />
                        <div className="h-3 bg-muted rounded w-1/2" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : Array.isArray(messages) && messages.length > 0 ? (
              <div className="space-y-3">
                {messages.map((message) => {
                  const isOwnMessage = message.senderId === user?.id;
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                      data-testid={`message-${message.id}`}
                    >
                      <div className={`max-w-[75%] ${isOwnMessage ? "order-2" : "order-1"}`}>
                        <div
                          className={`p-3 rounded-lg ${
                            isOwnMessage
                              ? "bg-primary text-white"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          <p className="text-sm">{message.content}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 px-1">
                          {format(new Date(message.createdAt), "HH:mm")}
                        </p>
                      </div>
                      {!isOwnMessage && (
                        <Avatar className="w-6 h-6 order-1 mr-2 mt-auto">
                          <AvatarImage src={message.sender?.profileImageUrl || undefined} />
                          <AvatarFallback className="text-xs">
                            {message.sender?.firstName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <i className="fas fa-comments text-3xl mb-2" />
                  <p className="text-sm">No messages yet</p>
                  <p className="text-xs">Start the conversation!</p>
                </div>
              </div>
            )}
          </ScrollArea>

          {/* Message Input */}
          <div className="p-4 border-t flex-shrink-0">
            <form onSubmit={handleSendMessage} className="flex space-x-2">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a message..."
                className="flex-1"
                disabled={sendMessageMutation.isPending}
                data-testid="input-message"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newMessage.trim() || sendMessageMutation.isPending}
                data-testid="button-send-message"
              >
                {sendMessageMutation.isPending ? (
                  <i className="fas fa-spinner fa-spin" />
                ) : (
                  <i className="fas fa-paper-plane" />
                )}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
