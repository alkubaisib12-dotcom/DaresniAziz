import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { formatMoney } from "@/lib/currency";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";

import {
  Bell,
  CheckCircle,
  Clock,
  Users,
  GraduationCap,
  BookOpen,
  AlertCircle,
  RefreshCw,
  User,
  Trash2,
  Shield,
  Eye,
  MessageSquare,
  XCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  isRead: boolean;
  createdAt: string;
}

interface TutorProfile {
  profile: {
    id: string;
    userId: string;
    bio: string;
    phone: string;
    hourlyRate: number;
    experience: string;
    education: string;
    isVerified: boolean;
    isActive: boolean;
    createdAt: string;
    certifications?: string[];
    availability?: Record<string, any>;
  };
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    profileImageUrl?: string;
  } | null;
  subjects?: Array<{ id: string; name: string }>;
}

interface Student {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
}

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
}

interface BasicUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role?: string | null;
}

interface AdminMessage {
  id: string;
  senderId: string;
  receiverId: string;
  studentId: string;
  tutorId: string;
  content: string;
  read: boolean;
  createdAt: string;
  conversationKey: string;
  sender?: BasicUser | null;
  receiver?: BasicUser | null;
  student?: BasicUser | null;
  tutor?: BasicUser | null;
}

const formatUserName = (user?: { firstName: string | null; lastName: string | null; email?: string } | null) => {
  if (!user) return "Unknown user";
  const full = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return full || user.email || "Unknown user";
};

export default function AdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const isAdmin = user?.role === "admin";

  const [currentTab, setCurrentTab] = useState<
    "pending" | "notifications" | "students" | "tutors" | "admins"
  >("pending");
  const [userToDelete, setUserToDelete] = useState<{ id: string; type: string; name: string } | null>(
    null,
  );
  const [selectedTutor, setSelectedTutor] = useState<TutorProfile | null>(null);
  const [tutorToReject, setTutorToReject] = useState<TutorProfile | null>(null);
  const [chatViewer, setChatViewer] = useState<
    { mode: "student" | "tutor"; userId: string; name: string } | null
  >(null);
  const [activeConversationKey, setActiveConversationKey] = useState<string | null>(null);

  const openChatHistory = (mode: "student" | "tutor", userId: string, name: string) => {
    setChatViewer({ mode, userId, name });
  };

  const closeChatHistory = () => {
    setChatViewer(null);
    setActiveConversationKey(null);
  };

  // Redirect away if not admin (runs after first render)
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate("/", { replace: true });
    }
  }, [authLoading, isAdmin, navigate]);

  useEffect(() => {
    if (!chatViewer) {
      setActiveConversationKey(null);
      return;
    }

    const keys = Array.from(new Set(chatHistory?.messages?.map((m) => m.conversationKey) || []));
    if (keys.length === 0) {
      setActiveConversationKey(null);
      return;
    }

    if (!activeConversationKey || !keys.includes(activeConversationKey)) {
      setActiveConversationKey(keys[0]);
    }
  }, [activeConversationKey, chatHistory, chatViewer]);

  // Fetch notifications
  const {
    data: notifications = [],
    isLoading: notificationsLoading,
    refetch: refetchNotifications,
  } = useQuery<Notification[]>({
    queryKey: ["/api/admin/notifications"],
    enabled: isAdmin,
    refetchInterval: isAdmin ? 30000 : false,
  });

  // Fetch students
  const { data: students = [], isLoading: studentsLoading } = useQuery<Student[]>({
    queryKey: ["/api/admin/students"],
    enabled: isAdmin && currentTab === "students",
  });

  // Fetch all tutors
  const { data: allTutors = [], isLoading: tutorsLoading } = useQuery<TutorProfile[]>({
    queryKey: ["/api/admin/tutors"],
    enabled: isAdmin && (currentTab === "tutors" || currentTab === "pending"),
  });

  // Fetch pending tutors
  const {
    data: pendingTutors = [],
    isLoading: pendingLoading,
    refetch: refetchPending,
  } = useQuery<TutorProfile[]>({
    queryKey: ["/api/admin/pending-tutors"],
    enabled: isAdmin && currentTab === "pending",
    refetchInterval: isAdmin && currentTab === "pending" ? 10000 : false,
  });

  // Fetch admin users
  const { data: adminUsers = [], isLoading: adminsLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/admins"],
    enabled: isAdmin && currentTab === "admins",
  });

  const { data: chatHistory, isLoading: chatHistoryLoading } = useQuery<{ messages: AdminMessage[] }>(
    {
      queryKey: ["/api/admin/messages", chatViewer?.mode, chatViewer?.userId],
      queryFn: async () => {
        if (!chatViewer) return { messages: [] };
        const param = chatViewer.mode === "student" ? `studentId=${chatViewer.userId}` : `tutorId=${chatViewer.userId}`;
        return apiRequest(`/api/admin/messages?${param}`);
      },
      enabled: isAdmin && !!chatViewer,
    },
  );

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      return apiRequest(`/api/admin/notifications/${notificationId}/read`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications"] });
    },
  });

  // Verify tutor (approve)
  const verifyTutorMutation = useMutation({
    mutationFn: async (tutorId: string) => {
      return apiRequest(`/api/tutors/${tutorId}/verify`, {
        method: "PUT",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tutors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tutors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tutors"] });

      toast({
        title: "✅ Tutor Approved",
        description: "The tutor has been verified and can now accept students.",
      });

      setSelectedTutor(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve tutor. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject tutor
  const rejectTutorMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest(`/api/admin/tutors/${userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tutors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pending-tutors"] });

      toast({
        title: "Tutor Rejected",
        description: "The tutor application has been rejected and deleted.",
      });

      setTutorToReject(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reject tutor.",
        variant: "destructive",
      });
      setTutorToReject(null);
    },
  });

  // Delete student
  const deleteStudentMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest(`/api/admin/students/${userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/students"] });
      toast({
        title: "Student deleted",
        description: "The student account has been successfully deleted.",
      });
      setUserToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete student.",
        variant: "destructive",
      });
      setUserToDelete(null);
    },
  });

  // Delete tutor
  const deleteTutorMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest(`/api/admin/tutors/${userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tutors"] });
      toast({
        title: "Tutor deleted",
        description: "The tutor account has been successfully deleted.",
      });
      setUserToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete tutor.",
        variant: "destructive",
      });
      setUserToDelete(null);
    },
  });

  // Delete admin user
  const deleteAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest(`/api/admin/admins/${userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/admins"] });
      toast({
        title: "Admin deleted",
        description: "The admin user has been successfully deleted.",
      });
      setUserToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete admin user.",
        variant: "destructive",
      });
      setUserToDelete(null);
    },
  });

  const handleDeleteUser = () => {
    if (!userToDelete) return;

    if (userToDelete.type === "student") {
      deleteStudentMutation.mutate(userToDelete.id);
    } else if (userToDelete.type === "tutor") {
      deleteTutorMutation.mutate(userToDelete.id);
    } else if (userToDelete.type === "admin") {
      deleteAdminMutation.mutate(userToDelete.id);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const pendingCount = pendingTutors.length;

  const chatMessages = chatHistory?.messages || [];
  const conversationMap = new Map<
    string,
    { key: string; student?: BasicUser | null; tutor?: BasicUser | null; messages: AdminMessage[] }
  >();

  chatMessages.forEach((msg) => {
    const key = msg.conversationKey || `${msg.studentId}_${msg.tutorId}`;
    const existing = conversationMap.get(key) || {
      key,
      student: msg.student,
      tutor: msg.tutor,
      messages: [] as AdminMessage[],
    };

    existing.student = existing.student || msg.student;
    existing.tutor = existing.tutor || msg.tutor;
    existing.messages.push(msg);
    conversationMap.set(key, existing);
  });

  const conversations = Array.from(conversationMap.values()).sort((a, b) => {
    const lastA = a.messages[a.messages.length - 1]?.createdAt || "";
    const lastB = b.messages[b.messages.length - 1]?.createdAt || "";
    return new Date(lastB).getTime() - new Date(lastA).getTime();
  });

  const activeConversation =
    conversations.find((c) => c.key === activeConversationKey) || conversations[0] || null;
  const activeMessages = activeConversation?.messages || [];

  // IMPORTANT: this comes *after* all hooks, so hooks order is stable
  if (authLoading || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#9B1B30]" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#9B1B30]">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Manage platform users, verify tutors, and monitor system activity.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => setCurrentTab("pending")}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">⏳ Pending Approval</p>
                <p className="text-3xl font-bold text-orange-600">{pendingCount}</p>
              </div>
              <Clock className="h-10 w-10 text-orange-500" />
            </div>
            {pendingCount > 0 && (
              <Badge variant="destructive" className="mt-2">
                Action Required
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Students</p>
                <p className="text-2xl font-bold">{students.length}</p>
              </div>
              <BookOpen className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Verified Tutors</p>
                <p className="text-2xl font-bold">
                  {allTutors.filter((t) => t.profile.isVerified).length}
                </p>
              </div>
              <GraduationCap className="h-8 w-8 text-[#9B1B30]" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Unread Notifications</p>
                <p className="text-2xl font-bold">{unreadCount}</p>
              </div>
              <Bell className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab Navigation */}
      <Tabs
        value={currentTab}
        onValueChange={(v: any) => setCurrentTab(v)}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="pending" className="relative">
            <Clock className="h-4 w-4 mr-2" />
            Pending Review
            {pendingCount > 0 && (
              <Badge
                variant="destructive"
                className="ml-2 h-5 w-5 p-0 text-xs flex items-center justify-center"
              >
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="h-4 w-4 mr-2" />
            Notifications
            {unreadCount > 0 && <Badge variant="destructive">{unreadCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="students">
            <BookOpen className="h-4 w-4 mr-2" />
            Students
          </TabsTrigger>
          <TabsTrigger value="tutors">
            <GraduationCap className="h-4 w-4 mr-2" />
            All Tutors
          </TabsTrigger>
          <TabsTrigger value="admins">
            <Shield className="h-4 w-4 mr-2" />
            Admins
          </TabsTrigger>
        </TabsList>

        {/* PENDING TUTORS TAB */}
        <TabsContent value="pending">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  <span>Pending Tutor Applications</span>
                </CardTitle>
                <CardDescription>
                  Review and approve tutor applications. Tutors will be notified immediately.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchPending()}
                disabled={pendingLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${pendingLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </CardHeader>
            <CardContent>
              {pendingLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#9B1B30]" />
                </div>
              ) : pendingCount === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-500" />
                  <p className="text-lg font-medium">All caught up!</p>
                  <p className="text-sm">No pending tutor applications to review.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {pendingTutors.map((tutor) => (
                    <Card
                      key={tutor.profile.id}
                      className="border-2 border-orange-200 bg-orange-50/50"
                    >
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center space-x-4">
                            <div className="h-16 w-16 rounded-full bg-[#9B1B30] text-white flex items-center justify-center text-xl font-bold">
                              {tutor.user?.firstName?.[0]}
                              {tutor.user?.lastName?.[0]}
                            </div>
                            <div>
                              <h3 className="font-bold text-lg">
                                {tutor.user?.firstName} {tutor.user?.lastName}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {tutor.user?.email}
                              </p>
                              <Badge
                                variant="outline"
                                className="mt-1 text-orange-600 border-orange-600"
                              >
                                ⏳ Awaiting Review
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                          <div>
                            <p className="font-medium text-muted-foreground">Hourly Rate</p>
                            <p className="text-lg font-semibold">
  {formatMoney(tutor.profile.hourlyRate)}/hr
</p>

                          </div>
                          <div>
                            <p className="font-medium text-muted-foreground">Phone</p>
                            <p>{tutor.profile.phone}</p>
                          </div>
                          <div>
                            <p className="font-medium text-muted-foreground">Subjects</p>
                            <p>{tutor.subjects?.length || 0} subjects</p>
                          </div>
                          <div>
                            <p className="font-medium text-muted-foreground">Applied</p>
                            <p>
                              {new Date(
                                tutor.profile.createdAt,
                              ).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <div className="flex gap-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedTutor(tutor)}
                            className="flex-1"
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Review Details
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() =>
                              verifyTutorMutation.mutate(tutor.profile.id)
                            }
                            disabled={verifyTutorMutation.isPending}
                            className="flex-1 bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setTutorToReject(tutor)}
                            className="flex-1"
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            Reject
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* NOTIFICATIONS TAB */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <Bell className="h-5 w-5" />
                  <span>Recent Notifications</span>
                </CardTitle>
                <CardDescription>
                  System notifications and alerts requiring your attention.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchNotifications()}
                disabled={notificationsLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${notificationsLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#9B1B30]" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No notifications yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 rounded-lg border ${
                        notification.isRead
                          ? "bg-background border-border"
                          : "bg-blue-50 border-blue-200"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <AlertCircle className="h-4 w-4 text-[#9B1B30]" />
                            <h4 className="font-medium">{notification.title}</h4>
                            {!notification.isRead && (
                              <Badge variant="destructive" className="text-xs">
                                New
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {notification.body}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                        {!notification.isRead && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              markAsReadMutation.mutate(notification.id)
                            }
                            disabled={markAsReadMutation.isPending}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* STUDENTS TAB */}
        <TabsContent value="students">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <BookOpen className="h-5 w-5" />
                <span>All Students</span>
              </CardTitle>
              <CardDescription>
                View and manage student accounts on the platform.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {studentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#9B1B30]" />
                </div>
              ) : students.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No students registered yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {students.map((student) => (
                    <div
                      key={student.id}
                      className="p-4 border rounded-lg flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center">
                          <User className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold">
                            {student.firstName} {student.lastName}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {student.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Joined{" "}
                            {new Date(student.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openChatHistory("student", student.id, formatUserName(student))
                          }
                        >
                          <MessageSquare className="h-4 w-4 mr-1" />
                          View Chats
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            setUserToDelete({
                              id: student.id,
                              type: "student",
                              name: `${student.firstName} ${student.lastName}`,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ALL TUTORS TAB */}
        <TabsContent value="tutors">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <GraduationCap className="h-5 w-5" />
                <span>All Tutors</span>
              </CardTitle>
              <CardDescription>
                All tutors (verified and pending) on the platform.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tutorsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#9B1B30]" />
                </div>
              ) : allTutors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GraduationCap className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No tutors registered yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {allTutors.map((tutor) => (
                    <div
                      key={tutor.profile.id}
                      className="p-4 border rounded-lg"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div className="h-10 w-10 rounded-full bg-[#9B1B30] text-white flex items-center justify-center">
                            <User className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-semibold">
                              {tutor.user?.firstName} {tutor.user?.lastName}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {tutor.user?.email}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Joined{" "}
                              {new Date(
                                tutor.profile.createdAt,
                              ).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {tutor.profile.isVerified ? (
                            <Badge variant="default" className="bg-green-600">
                              ✓ Verified
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-orange-600 border-orange-600"
                            >
                              ⏳ Pending
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 text-sm">
                        <div>
                          <p className="font-medium">Hourly Rate</p>
                         <p className="text-muted-foreground">
  {formatMoney(tutor.profile.hourlyRate)}/hour
</p>

                        </div>
                        <div>
                          <p className="font-medium">Phone</p>
                          <p className="text-muted-foreground">
                            {tutor.profile.phone}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium">Status</p>
                          <p className="text-muted-foreground">
                            {tutor.profile.isActive ? "Active" : "Inactive"}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!tutor.user?.id}
                          onClick={() =>
                            tutor.user?.id &&
                            openChatHistory("tutor", tutor.user.id, formatUserName(tutor.user))
                          }
                        >
                          <MessageSquare className="h-4 w-4 mr-1" />
                          View Chats
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedTutor(tutor)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View Details
                        </Button>
                        {!tutor.profile.isVerified && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() =>
                              verifyTutorMutation.mutate(tutor.profile.id)
                            }
                            disabled={verifyTutorMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            setUserToDelete({
                              id: tutor.user?.id || "",
                              type: "tutor",
                              name: `${tutor.user?.firstName} ${tutor.user?.lastName}`,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ADMINS TAB */}
        <TabsContent value="admins">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Shield className="h-5 w-5" />
                <span>Admin Management</span>
              </CardTitle>
              <CardDescription>
                View all admin accounts and manage admin access.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {adminsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#9B1B30]" />
                </div>
              ) : adminUsers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No admin accounts found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {adminUsers.map((admin) => (
                    <div
                      key={admin.id}
                      className="p-4 border rounded-lg flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="h-10 w-10 rounded-full bg-purple-600 text-white flex items-center justify-center">
                          <Shield className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold">
                            {admin.firstName} {admin.lastName}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {admin.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Joined{" "}
                            {new Date(admin.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          setUserToDelete({
                            id: admin.id,
                            type: "admin",
                            name: `${admin.firstName} ${admin.lastName}`,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!chatViewer} onOpenChange={(open) => !open && closeChatHistory()}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Chat history</DialogTitle>
            <DialogDescription>
              Viewing conversations for {chatViewer?.name} as a {chatViewer?.mode}.
            </DialogDescription>
          </DialogHeader>

          {chatHistoryLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#9B1B30]" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <MessageSquare className="h-10 w-10 mx-auto mb-2 text-muted-foreground/50" />
              <p>No messages found for this user yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {conversations.map((conv) => {
                  const counterpart = chatViewer?.mode === "student" ? conv.tutor : conv.student;
                  const last = conv.messages[conv.messages.length - 1];

                  return (
                    <button
                      key={conv.key}
                      className={`w-full text-left p-3 rounded-lg border transition ${
                        conv.key === activeConversation?.key
                          ? "border-[#9B1B30] bg-rose-50"
                          : "border-border bg-background hover:border-[#9B1B30]/50"
                      }`}
                      onClick={() => setActiveConversationKey(conv.key)}
                    >
                      <p className="font-semibold">
                        {chatViewer?.mode === "student" ? "Tutor" : "Student"}: {formatUserName(counterpart)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conv.messages.length} messages · Last {new Date(last.createdAt).toLocaleString()}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="md:col-span-2">
                {activeConversation ? (
                  <div className="space-y-3 max-h-[420px] overflow-y-auto">
                    <div className="flex items-center justify-between bg-muted p-3 rounded-lg">
                      <div>
                        <p className="text-sm text-muted-foreground">Student</p>
                        <p className="font-semibold">{formatUserName(activeConversation.student)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Tutor</p>
                        <p className="font-semibold">{formatUserName(activeConversation.tutor)}</p>
                      </div>
                    </div>

                    {activeMessages.map((msg) => {
                      const isStudentMessage = msg.senderId === activeConversation.student?.id;
                      return (
                        <div
                          key={msg.id}
                          className={`p-3 rounded-lg border ${
                            isStudentMessage ? "bg-blue-50/70 border-blue-200" : "bg-emerald-50/70 border-emerald-200"
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{formatUserName(msg.sender)}</span>
                            <span>{new Date(msg.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="mt-2 text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      );
                    })}

                    {activeMessages.length === 0 && (
                      <div className="text-center text-muted-foreground py-6">
                        No messages in this conversation yet.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-6">Select a conversation to view messages.</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the {userToDelete?.type} account for{" "}
              <strong>{userToDelete?.name}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete {userToDelete?.type}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Tutor Confirmation Dialog */}
      <AlertDialog open={!!tutorToReject} onOpenChange={() => setTutorToReject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Tutor Application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently reject and delete the tutor application for{" "}
              <strong>
                {tutorToReject?.user?.firstName} {tutorToReject?.user?.lastName}
              </strong>
              . The user will need to reapply if they want to become a tutor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (tutorToReject?.user?.id) {
                  rejectTutorMutation.mutate(tutorToReject.user.id);
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Reject Application
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tutor Details Dialog */}
      <Dialog open={!!selectedTutor} onOpenChange={() => setSelectedTutor(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tutor Application Review</DialogTitle>
            <DialogDescription>
              Complete information for {selectedTutor?.user?.firstName}{" "}
              {selectedTutor?.user?.lastName}
            </DialogDescription>
          </DialogHeader>
          {selectedTutor && (
            <div className="space-y-6">
              {/* Personal Info */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center">
                  <User className="h-5 w-5 mr-2" />
                  Personal Information
                </h3>
                <div className="grid grid-cols-2 gap-4 bg-muted p-4 rounded-lg">
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">Full Name</p>
                    <p className="text-base">
                      {selectedTutor.user?.firstName} {selectedTutor.user?.lastName}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">Email</p>
                    <p className="text-base">{selectedTutor.user?.email}</p>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">Phone</p>
                    <p className="text-base">{selectedTutor.profile.phone}</p>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">
                      Hourly Rate
                    </p>
                    <p className="text-base font-bold text-[#9B1B30]">
  {formatMoney(selectedTutor.profile.hourlyRate)}/hour
</p>

                  </div>
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">
                      Application Date
                    </p>
                    <p className="text-base">
                      {new Date(
                        selectedTutor.profile.createdAt,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">Status</p>
                    <Badge
                      variant={
                        selectedTutor.profile.isVerified ? "default" : "outline"
                      }
                    >
                      {selectedTutor.profile.isVerified
                        ? "✓ Verified"
                        : "⏳ Pending"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Bio */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Professional Bio</h3>
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm leading-relaxed">
                    {selectedTutor.profile.bio || "No bio provided"}
                  </p>
                </div>
              </div>

              {/* Education & Experience */}
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <GraduationCap className="h-5 w-5 mr-2" />
                    Education
                  </h3>
                  <div className="bg-muted p-4 rounded-lg">
                    <p className="text-sm leading-relaxed">
                      {selectedTutor.profile.education || "Not provided"}
                    </p>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center">
                    <BookOpen className="h-5 w-5 mr-2" />
                    Experience
                  </h3>
                  <div className="bg-muted p-4 rounded-lg">
                    <p className="text-sm leading-relaxed">
                      {selectedTutor.profile.experience || "Not provided"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Subjects */}
              {selectedTutor.subjects && selectedTutor.subjects.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Subjects to Teach</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedTutor.subjects.map((subject) => (
                      <Badge
                        key={subject.id}
                        variant="secondary"
                        className="px-3 py-1"
                      >
                        {subject.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Certifications */}
              {selectedTutor.profile.certifications &&
                selectedTutor.profile.certifications.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Certifications</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      {selectedTutor.profile.certifications.map((cert, idx) => (
                        <li key={idx}>{cert}</li>
                      ))}
                    </ul>
                  </div>
                )}

              {/* Availability */}
              {selectedTutor.profile.availability && (
                <div>
                  <h3 className="text-lg font-semibold mb-3">Weekly Availability</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(
                      selectedTutor.profile.availability,
                    ).map(([day, avail]: [string, any]) => (
                      <div key={day} className="bg-muted p-3 rounded-lg">
                        <p className="font-medium text-sm capitalize">{day}</p>
                        {avail.isAvailable ? (
                          <p className="text-xs text-green-600">
                            {avail.startTime} - {avail.endTime}
                          </p>
                        ) : (
                          <p className="text-xs text-red-600">Unavailable</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                {!selectedTutor.profile.isVerified && (
                  <>
                    <Button
                      onClick={() =>
                        verifyTutorMutation.mutate(selectedTutor.profile.id)
                      }
                      disabled={verifyTutorMutation.isPending}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {verifyTutorMutation.isPending
                        ? "Approving..."
                        : "Approve Tutor"}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setSelectedTutor(null);
                        setTutorToReject(selectedTutor);
                      }}
                      className="flex-1"
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject Application
                    </Button>
                  </>
                )}
                {selectedTutor.profile.isVerified && (
                  <Badge
                    variant="default"
                    className="bg-green-600 text-lg py-2 px-4"
                  >
                    ✓ Already Verified
                  </Badge>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
