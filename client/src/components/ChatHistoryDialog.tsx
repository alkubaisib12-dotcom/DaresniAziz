import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface ChatHistoryDialogProps {
  userId: string;
  userType: "student" | "tutor";
  userName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ChatUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
};

type ChatMessage = {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  fileUrl?: string | null;
  read: boolean;
  createdAt: string;
  sender?: ChatUser | null;
  receiver?: ChatUser | null;
};

type ConversationGroup = {
  partnerId: string;
  partnerName: string;
  partnerRole: string;
  partnerAvatar?: string | null;
  messages: ChatMessage[];
};

export function ChatHistoryDialog({
  userId,
  userType,
  userName,
  open,
  onOpenChange,
}: ChatHistoryDialogProps) {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);

  // Fetch all messages for this user
  const { data: messages, isLoading } = useQuery<ChatMessage[]>({
    queryKey: [`/api/admin/${userType}s`, userId, "messages"],
    queryFn: () => apiRequest(`/api/admin/${userType}s/${userId}/messages`),
    enabled: open,
  });

  // Group messages by conversation partner
  const conversations: ConversationGroup[] = [];
  if (messages && messages.length > 0) {
    const conversationMap = new Map<string, ConversationGroup>();

    messages.forEach((message) => {
      // Determine who the conversation partner is
      const isUserSender = message.senderId === userId;
      const partnerId = isUserSender ? message.receiverId : message.senderId;
      const partner = isUserSender ? message.receiver : message.sender;

      if (!conversationMap.has(partnerId)) {
        conversationMap.set(partnerId, {
          partnerId,
          partnerName: partner
            ? `${partner.firstName || ""} ${partner.lastName || ""}`.trim() || "Unknown"
            : "Unknown",
          partnerRole: partner?.role || "unknown",
          partnerAvatar: partner?.profileImageUrl,
          messages: [],
        });
      }

      conversationMap.get(partnerId)!.messages.push(message);
    });

    conversations.push(...Array.from(conversationMap.values()));

    // Sort conversations by latest message
    conversations.sort((a, b) => {
      const latestA = a.messages[a.messages.length - 1];
      const latestB = b.messages[b.messages.length - 1];
      return new Date(latestB.createdAt).getTime() - new Date(latestA.createdAt).getTime();
    });
  }

  // Auto-select first conversation when dialog opens
  useEffect(() => {
    if (open && conversations.length > 0 && !selectedConversation) {
      setSelectedConversation(conversations[0].partnerId);
    }
  }, [open, conversations, selectedConversation]);

  // Reset selection when dialog closes
  useEffect(() => {
    if (!open) {
      setSelectedConversation(null);
    }
  }, [open]);

  const selectedConv = conversations.find((c) => c.partnerId === selectedConversation);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[80vh] p-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>
            Chat History - {userName} ({userType})
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <i className="fas fa-spinner fa-spin text-3xl text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Loading chat history...</p>
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <i className="fas fa-comments text-3xl text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No messages found</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Conversation List */}
            <div className="w-80 border-r flex flex-col">
              <div className="p-4 border-b">
                <h3 className="font-semibold text-sm text-muted-foreground">
                  Conversations ({conversations.length})
                </h3>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {conversations.map((conv) => (
                    <Button
                      key={conv.partnerId}
                      variant={selectedConversation === conv.partnerId ? "secondary" : "ghost"}
                      className="w-full justify-start h-auto py-3 px-3"
                      onClick={() => setSelectedConversation(conv.partnerId)}
                    >
                      <Avatar className="w-10 h-10 mr-3">
                        <AvatarImage src={conv.partnerAvatar || undefined} />
                        <AvatarFallback>
                          {conv.partnerName.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 text-left min-w-0">
                        <div className="font-medium text-sm truncate">{conv.partnerName}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {conv.partnerRole}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {conv.messages.length} messages
                          </span>
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Messages Display */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedConv ? (
                <>
                  <div className="p-4 border-b">
                    <div className="flex items-center space-x-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={selectedConv.partnerAvatar || undefined} />
                        <AvatarFallback>
                          {selectedConv.partnerName.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-semibold">{selectedConv.partnerName}</h3>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{selectedConv.partnerRole}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {selectedConv.messages.length} messages
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4 max-w-4xl mx-auto">
                      {selectedConv.messages.map((message, index) => {
                        const isUserMessage = message.senderId === userId;
                        const showDateSeparator =
                          index === 0 ||
                          format(new Date(message.createdAt), "yyyy-MM-dd") !==
                            format(
                              new Date(selectedConv.messages[index - 1].createdAt),
                              "yyyy-MM-dd"
                            );

                        return (
                          <div key={message.id}>
                            {showDateSeparator && (
                              <div className="flex items-center justify-center my-4">
                                <Separator className="flex-1" />
                                <span className="px-4 text-xs text-muted-foreground">
                                  {format(new Date(message.createdAt), "MMMM dd, yyyy")}
                                </span>
                                <Separator className="flex-1" />
                              </div>
                            )}

                            <div
                              className={`flex ${isUserMessage ? "justify-end" : "justify-start"}`}
                            >
                              <div className={`max-w-[70%] ${isUserMessage ? "order-2" : "order-1"}`}>
                                <div className="flex items-center gap-2 mb-1 px-1">
                                  {!isUserMessage && (
                                    <Avatar className="w-6 h-6">
                                      <AvatarImage
                                        src={message.sender?.profileImageUrl || undefined}
                                      />
                                      <AvatarFallback className="text-xs">
                                        {message.sender?.firstName?.[0]}
                                      </AvatarFallback>
                                    </Avatar>
                                  )}
                                  <span className="text-xs font-medium">
                                    {isUserMessage
                                      ? userName
                                      : `${message.sender?.firstName || ""} ${message.sender?.lastName || ""}`.trim()}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(message.createdAt), "HH:mm")}
                                  </span>
                                </div>

                                <Card
                                  className={`${
                                    isUserMessage
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted"
                                  }`}
                                >
                                  <CardContent className="p-3">
                                    <p className="text-sm whitespace-pre-wrap break-words">
                                      {message.content}
                                    </p>
                                    {message.fileUrl && (
                                      <div className="mt-2 pt-2 border-t border-current/20">
                                        <a
                                          href={message.fileUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs flex items-center gap-1 hover:underline"
                                        >
                                          <i className="fas fa-paperclip" />
                                          <span>Attachment</span>
                                        </a>
                                      </div>
                                    )}
                                  </CardContent>
                                </Card>

                                <div className="flex items-center gap-2 mt-1 px-1">
                                  {message.read ? (
                                    <Badge variant="outline" className="text-xs">
                                      Read
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs">
                                      Unread
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <div className="flex items-center justify-center flex-1">
                  <div className="text-center">
                    <i className="fas fa-arrow-left text-3xl text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Select a conversation to view messages
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
