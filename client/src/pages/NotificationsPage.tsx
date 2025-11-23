// client/src/pages/NotificationsPage.tsx
import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Check,
  Clock,
  Calendar,
  MessageCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ChatWindow } from "@/components/ChatWindow";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: any;
  data?: any;
};

async function fetchNotifications(): Promise<Notification[]> {
  const res = await fetch("/api/notifications", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

async function markAsRead(notificationId: string) {
  const res = await fetch(`/api/notifications/${notificationId}/read`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to mark as read");
  return res.json();
}

// Try to infer the other participant’s userId from the notification payload
function getChatUserId(n: Notification): string | undefined {
  return (
    n.data?.otherUserId ??
    n.data?.userId ??
    n.data?.fromUserId ??
    n.data?.senderId
  );
}

function isMessageNotification(n: Notification): boolean {
  return (
    n.type === "NEW_MESSAGE" ||
    n.type === "MESSAGE" ||
    n.type === "MESSAGE_RECEIVED" ||
    !!getChatUserId(n)
  );
}

export default function NotificationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeChatUserId, setActiveChatUserId] = useState<string | null>(null);

  const {
    data: notifications = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
  });

  const markReadMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark notification as read.",
        variant: "destructive",
      });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async (toMark: Notification[]) => {
      const unread = toMark.filter((n) => !n.isRead);
      if (!unread.length) return;
      await Promise.all(unread.map((n) => markAsRead(n.id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      toast({
        title: "All caught up",
        description: "All notifications marked as read.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to mark all as read.",
        variant: "destructive",
      });
    },
  });

  const handleMarkAsRead = (notificationId: string) => {
    markReadMutation.mutate(notificationId);
  };

  const handleMarkAllAsRead = () => {
    if (!notifications.length) return;
    markAllReadMutation.mutate(notifications);
  };

  const handleOpenChat = (notification: Notification) => {
    const chatUserId = getChatUserId(notification);
    if (!chatUserId) {
      toast({
        title: "Chat not available",
        description: "No user is attached to this notification.",
        variant: "destructive",
      });
      return;
    }

    if (!notification.isRead) {
      markReadMutation.mutate(notification.id);
    }

    setActiveChatUserId(chatUserId);
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "SESSION_REQUESTED":
        return <Calendar className="h-5 w-5 text-blue-500" />;
      case "SESSION_CONFIRMED":
        return <Check className="h-5 w-5 text-green-500" />;
      case "SESSION_CANCELLED":
        return <Clock className="h-5 w-5 text-red-500" />;
      default:
        return <Bell className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatDate = (timestamp: any) => {
    try {
      let date: Date;

      if (timestamp?.toDate) {
        date = timestamp.toDate();
      } else if (timestamp?._seconds) {
        date = new Date(timestamp._seconds * 1000);
      } else if (typeof timestamp === "string" || typeof timestamp === "number") {
        date = new Date(timestamp);
      } else {
        return "Recently";
      }

      // Validate the date before formatting
      if (isNaN(date.getTime())) {
        return "Recently";
      }

      return format(date, "MMM dd, yyyy 'at' h:mm a");
    } catch {
      return "Recently";
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pt-16">
        <div className="container mx-auto py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="mt-2 text-muted-foreground">
                Loading notifications...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background pt-16">
        <div className="container mx-auto py-8">
          <div className="max-w-3xl mx-auto">
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-red-600 font-semibold">
                  Failed to load notifications
                </p>
                <p className="text-muted-foreground mt-2">
                  Please refresh the page and try again.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="container mx-auto py-8 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">Notifications</h1>
              <p className="text-muted-foreground mt-2">
                Stay updated with your tutoring sessions and messages
              </p>
            </div>

            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleMarkAllAsRead}
                disabled={
                  markAllReadMutation.isPending || markReadMutation.isPending
                }
              >
                <Check className="h-4 w-4 mr-1" />
                Mark all as read ({unreadCount})
              </Button>
            )}
          </div>

          {notifications.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Bell className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-center">
                  No notifications yet
                </p>
                <p className="text-sm text-muted-foreground text-center mt-2">
                  When you have new session requests, messages, or updates,
                  they&apos;ll appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => {
                const isMessage = isMessageNotification(notification);
                const chatUserId = getChatUserId(notification);

                return (
                  <Card
                    key={notification.id}
                    className={`transition-all ${
                      notification.isRead
                        ? "opacity-70"
                        : "border-primary/60 shadow-sm"
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="mt-1">
                          {getNotificationIcon(notification.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-sm">
                                  {notification.title}
                                </h3>
                                {!notification.isRead && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs border-primary text-primary"
                                  >
                                    New
                                  </Badge>
                                )}
                              </div>

                              <p className="text-sm text-muted-foreground mt-1">
                                {notification.body}
                              </p>

                              <p className="text-xs text-muted-foreground mt-2">
                                {formatDate(notification.createdAt)}
                              </p>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              {!notification.isRead && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    handleMarkAsRead(notification.id)
                                  }
                                  disabled={markReadMutation.isPending}
                                >
                                  <Check className="h-4 w-4 mr-1" />
                                  Mark as read
                                </Button>
                              )}

                              {isMessage && chatUserId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleOpenChat(notification)}
                                >
                                  <MessageCircle className="h-4 w-4 mr-1" />
                                  Open chat
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {activeChatUserId && (
        <ChatWindow
          userId={activeChatUserId}
          onClose={() => setActiveChatUserId(null)}
        />
      )}
    </div>
  );
}
