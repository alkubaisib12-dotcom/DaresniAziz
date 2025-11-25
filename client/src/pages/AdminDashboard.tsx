import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { formatMoney } from "@/lib/currency";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";

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
  TrendingUp,
  DollarSign,
  BarChart3,
  Activity,
  Calendar,
  CalendarIcon,
  Filter,
  X,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
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
import { ChatHistoryDialog } from "@/components/ChatHistoryDialog";

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
    subjectPricing?: Record<string, number>; // subject-specific pricing
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
  stats?: {
    totalSessions: number;
    completedSessions: number;
    cancelledSessions: number;
    completionRate: number;
    totalRevenue: number;
    averageRating: number;
    reviewCount: number;
  };
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

interface StudentDetails {
  student: Student;
  sessions: any[];
  stats: {
    totalSessions: number;
    completedSessions: number;
    upcomingSessions: number;
    cancelledSessions: number;
  };
}

interface TutorSessions {
  sessions: any[];
  stats: {
    totalSessions: number;
    completedSessions: number;
    upcomingSessions: number;
    cancelledSessions: number;
  };
}

interface AnalyticsData {
  userGrowth: Array<{ date: string; students: number; tutors: number }>;
  sessionStats: {
    completed: number;
    scheduled: number;
    pending: number;
    cancelled: number;
    inProgress: number;
  };
  subjectStats: Array<{ name: string; sessions: number }>;
  overview: {
    totalStudents: number;
    totalTutors: number;
    verifiedTutors: number;
    totalSessions: number;
    completedSessions: number;
    completionRate: number;
    totalRevenue: number;
  };
  recentActivity: Array<{
    id: string;
    status: string;
    scheduledAt: string;
  }>;
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  const isAdmin = user?.role === "admin";

  const [currentTab, setCurrentTab] = useState<
    "analytics" | "leaderboard" | "pending" | "notifications" | "students" | "tutors" | "admins"
  >("analytics");
  const [userToDelete, setUserToDelete] = useState<{ id: string; type: string; name: string } | null>(
    null,
  );
  const [selectedTutor, setSelectedTutor] = useState<TutorProfile | null>(null);
  const [tutorToReject, setTutorToReject] = useState<TutorProfile | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedTutorForSessions, setSelectedTutorForSessions] = useState<TutorProfile | null>(null);
  const [studentChatHistory, setStudentChatHistory] = useState<{ id: string; name: string } | null>(null);
  const [tutorChatHistory, setTutorChatHistory] = useState<{ id: string; name: string } | null>(null);
  const [tutorRankingTab, setTutorRankingTab] = useState<"overall" | "revenue" | "sessions" | "rating">("overall");

  // Date range filter state
  type DatePreset = "all" | "today" | "week" | "month" | "year" | "custom";
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);

  // Date range filter helpers
  const setDateRange = (preset: DatePreset) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    setDatePreset(preset);

    switch (preset) {
      case "all":
        setFromDate(undefined);
        setToDate(undefined);
        break;
      case "today":
        setFromDate(today);
        setToDate(new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1));
        break;
      case "week":
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        setFromDate(weekAgo);
        setToDate(now);
        break;
      case "month":
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        setFromDate(monthAgo);
        setToDate(now);
        break;
      case "year":
        const yearAgo = new Date(today);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        setFromDate(yearAgo);
        setToDate(now);
        break;
      case "custom":
        // Keep existing dates for custom range
        break;
    }
  };

  const isDateInRange = (dateString: string) => {
    if (!fromDate && !toDate) return true;

    const date = new Date(dateString);
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;

    return true;
  };

  // Helper function to safely format dates
  const formatDate = (dateValue: any): string => {
    if (!dateValue) return "N/A";

    try {
      let date: Date;

      // Handle Firestore Timestamp objects
      if (dateValue?.toDate && typeof dateValue.toDate === 'function') {
        date = dateValue.toDate();
      }
      // Handle Firestore Timestamp with _seconds
      else if (dateValue?._seconds) {
        date = new Date(dateValue._seconds * 1000);
      }
      // Handle Date objects
      else if (dateValue instanceof Date) {
        date = dateValue;
      }
      // Handle string/number
      else {
        date = new Date(dateValue);
      }

      // Validate the date
      if (isNaN(date.getTime())) return "N/A";

      return date.toLocaleDateString();
    } catch (error) {
      console.error("Error formatting date:", error, dateValue);
      return "N/A";
    }
  };

  // Helper function to safely format date and time
  const formatDateTime = (dateValue: any): string => {
    if (!dateValue) return "N/A";

    try {
      let date: Date;

      // Handle Firestore Timestamp objects
      if (dateValue?.toDate && typeof dateValue.toDate === 'function') {
        date = dateValue.toDate();
      }
      // Handle Firestore Timestamp with _seconds
      else if (dateValue?._seconds) {
        date = new Date(dateValue._seconds * 1000);
      }
      // Handle Date objects
      else if (dateValue instanceof Date) {
        date = dateValue;
      }
      // Handle string/number
      else {
        date = new Date(dateValue);
      }

      // Validate the date
      if (isNaN(date.getTime())) return "N/A";

      return date.toLocaleString();
    } catch (error) {
      console.error("Error formatting date:", error, dateValue);
      return "N/A";
    }
  };

  // Helper function to get tutor pricing display
  const getTutorPricing = (tutor: TutorProfile): string => {
    const { subjectPricing, hourlyRate } = tutor.profile;

    // If subjectPricing exists and has values, use it
    if (subjectPricing && Object.keys(subjectPricing).length > 0) {
      const prices = Object.values(subjectPricing).filter(p => p > 0);
      if (prices.length === 0) return "Not set";

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      if (minPrice === maxPrice) {
        return formatMoney(minPrice) + "/hour";
      } else {
        return `${formatMoney(minPrice)} - ${formatMoney(maxPrice)}/hour`;
      }
    }

    // Fallback to hourlyRate (deprecated field)
    if (hourlyRate && hourlyRate > 0) {
      return formatMoney(hourlyRate) + "/hour";
    }

    return "Not set";
  };

  // Redirect away if not admin (runs after first render)
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate("/", { replace: true });
    }
  }, [authLoading, isAdmin, navigate]);

  // Fetch analytics data
  const { data: analytics, isLoading: analyticsLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/analytics", fromDate?.toISOString(), toDate?.toISOString()],
    queryFn: () => {
      const params = new URLSearchParams();
      if (fromDate) params.append("fromDate", fromDate.toISOString());
      if (toDate) params.append("toDate", toDate.toISOString());
      const url = `/api/admin/analytics${params.toString() ? `?${params.toString()}` : ""}`;
      return apiRequest(url);
    },
    enabled: isAdmin && currentTab === "analytics",
    staleTime: 60000, // Cache for 1 minute
  });

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

  // Fetch student details with sessions
  const { data: studentDetails, isLoading: studentDetailsLoading } = useQuery<StudentDetails>({
    queryKey: ["/api/admin/students", selectedStudent?.id, "details"],
    queryFn: () => apiRequest(`/api/admin/students/${selectedStudent?.id}/details`),
    enabled: !!selectedStudent?.id,
  });

  // Fetch tutor sessions
  const { data: tutorSessions, isLoading: tutorSessionsLoading } = useQuery<TutorSessions>({
    queryKey: ["/api/admin/tutors", selectedTutorForSessions?.user?.id, "sessions"],
    queryFn: () => apiRequest(`/api/admin/tutors/${selectedTutorForSessions?.user?.id}/sessions`),
    enabled: !!selectedTutorForSessions?.user?.id,
  });

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

  // Mark all notifications as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/admin/notifications/mark-all-read", {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications"] });
      toast({
        title: "Success",
        description: `Marked ${data.count} notification${data.count !== 1 ? 's' : ''} as read`,
      });
    },
    onError: (error: any) => {
      console.error("Error marking notifications as read:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to mark notifications as read",
        variant: "destructive",
      });
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

  // Apply date filters to all data
  const filteredNotifications = notifications.filter((n) => isDateInRange(n.createdAt));
  const filteredPendingTutors = pendingTutors.filter((t) => isDateInRange(t.profile.createdAt));
  const filteredStudents = students.filter((s) => isDateInRange(s.createdAt));
  const filteredAllTutors = allTutors.filter((t) => isDateInRange(t.profile.createdAt));
  const filteredAdminUsers = adminUsers.filter((a) => isDateInRange(a.createdAt));

  // Rank and sort tutors based on selected tab
  const rankedTutors = useMemo(() => {
    const tutorsWithStats = filteredAllTutors.map(tutor => {
      const stats = tutor.stats || {
        totalSessions: 0,
        completedSessions: 0,
        completionRate: 0,
        totalRevenue: 0,
        averageRating: 0,
        reviewCount: 0,
      };

      // Calculate overall score: 40% rating + 40% sessions + 20% completion rate
      // Normalize each metric to 0-100 scale
      const ratingScore = (stats.averageRating / 5) * 100; // out of 5 stars
      const sessionsScore = Math.min((stats.completedSessions / 100) * 100, 100); // cap at 100 sessions
      const completionScore = stats.completionRate; // already a percentage

      const overallScore = (
        (ratingScore * 0.4) +
        (sessionsScore * 0.4) +
        (completionScore * 0.2)
      );

      return { ...tutor, stats, overallScore };
    });

    // Sort based on selected ranking tab
    return tutorsWithStats.sort((a, b) => {
      switch (tutorRankingTab) {
        case "overall":
          return b.overallScore - a.overallScore;
        case "revenue":
          return (b.stats?.totalRevenue || 0) - (a.stats?.totalRevenue || 0);
        case "sessions":
          return (b.stats?.completedSessions || 0) - (a.stats?.completedSessions || 0);
        case "rating":
          return (b.stats?.averageRating || 0) - (a.stats?.averageRating || 0);
        default:
          return 0;
      }
    });
  }, [filteredAllTutors, tutorRankingTab]);

  // Count ALL unread notifications (not just filtered) for the "Mark All as Read" button
  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const pendingCount = filteredPendingTutors.length;

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

      {/* Date Range Filter */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Filter by Date:</span>
            </div>

            {/* Preset Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={datePreset === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange("all")}
              >
                All Time
              </Button>
              <Button
                variant={datePreset === "today" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange("today")}
              >
                Today
              </Button>
              <Button
                variant={datePreset === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange("week")}
              >
                Last 7 Days
              </Button>
              <Button
                variant={datePreset === "month" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange("month")}
              >
                Last 30 Days
              </Button>
              <Button
                variant={datePreset === "year" ? "default" : "outline"}
                size="sm"
                onClick={() => setDateRange("year")}
              >
                Last Year
              </Button>
            </div>

            {/* Custom Date Range Pickers */}
            <div className="flex items-center gap-2 ml-auto">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={datePreset === "custom" ? "border-primary" : ""}
                  >
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {fromDate ? format(fromDate, "MMM dd, yyyy") : "From Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={fromDate}
                    onSelect={(date) => {
                      setFromDate(date);
                      setDatePreset("custom");
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <span className="text-muted-foreground">to</span>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={datePreset === "custom" ? "border-primary" : ""}
                  >
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {toDate ? format(toDate, "MMM dd, yyyy") : "To Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={toDate}
                    onSelect={(date) => {
                      setToDate(date);
                      setDatePreset("custom");
                    }}
                    initialFocus
                    disabled={(date) => fromDate ? date < fromDate : false}
                  />
                </PopoverContent>
              </Popover>

              {(fromDate || toDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDateRange("all")}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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
                <p className="text-2xl font-bold">{filteredStudents.length}</p>
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
                  {filteredAllTutors.filter((t) => t.profile.isVerified).length}
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
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="analytics">
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="leaderboard">
            <TrendingUp className="h-4 w-4 mr-2" />
            Leaderboard
          </TabsTrigger>
          <TabsTrigger value="pending" className="relative">
            <Clock className="h-4 w-4 mr-2" />
            Pending
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
            Alerts
            {unreadCount > 0 && <Badge variant="destructive">{unreadCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="students">
            <BookOpen className="h-4 w-4 mr-2" />
            Students
          </TabsTrigger>
          <TabsTrigger value="tutors">
            <GraduationCap className="h-4 w-4 mr-2" />
            Tutors
          </TabsTrigger>
          <TabsTrigger value="admins">
            <Shield className="h-4 w-4 mr-2" />
            Admins
          </TabsTrigger>
        </TabsList>

        {/* ANALYTICS TAB */}
        <TabsContent value="analytics">
          {analyticsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#9B1B30]" />
            </div>
          ) : analytics ? (
            <div className="space-y-6">
              {/* Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Sessions</p>
                        <p className="text-3xl font-bold">{analytics.overview.totalSessions}</p>
                        <p className="text-xs text-green-600 mt-1">
                          {analytics.overview.completedSessions} completed
                        </p>
                      </div>
                      <Activity className="h-10 w-10 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Completion Rate</p>
                        <p className="text-3xl font-bold">{analytics.overview.completionRate}%</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Success metric
                        </p>
                      </div>
                      <TrendingUp className="h-10 w-10 text-green-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
                        <p className="text-3xl font-bold">{formatMoney(analytics.overview.totalRevenue)}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          From completed sessions
                        </p>
                      </div>
                      <DollarSign className="h-10 w-10 text-[#9B1B30]" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Active Tutors</p>
                        <p className="text-3xl font-bold">{analytics.overview.verifiedTutors}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {analytics.overview.totalTutors} total
                        </p>
                      </div>
                      <Users className="h-10 w-10 text-purple-600" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* User Growth Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      User Growth (Last 30 Days)
                    </CardTitle>
                    <CardDescription>Students and tutors registered over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={analytics.userGrowth}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          fontSize={12}
                        />
                        <YAxis fontSize={12} />
                        <Tooltip
                          labelFormatter={(value) => new Date(value).toLocaleDateString()}
                          contentStyle={{ fontSize: 12 }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="students" stroke="#3b82f6" strokeWidth={2} name="Students" />
                        <Line type="monotone" dataKey="tutors" stroke="#9B1B30" strokeWidth={2} name="Tutors" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Session Status Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Session Status Distribution
                    </CardTitle>
                    <CardDescription>Breakdown of all sessions by status</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Completed', value: analytics.sessionStats.completed, color: '#10b981' },
                            { name: 'Scheduled', value: analytics.sessionStats.scheduled, color: '#3b82f6' },
                            { name: 'Pending', value: analytics.sessionStats.pending, color: '#f59e0b' },
                            { name: 'Cancelled', value: analytics.sessionStats.cancelled, color: '#ef4444' },
                            { name: 'In Progress', value: analytics.sessionStats.inProgress, color: '#8b5cf6' },
                          ].filter(item => item.value > 0)}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {[
                            { name: 'Completed', value: analytics.sessionStats.completed, color: '#10b981' },
                            { name: 'Scheduled', value: analytics.sessionStats.scheduled, color: '#3b82f6' },
                            { name: 'Pending', value: analytics.sessionStats.pending, color: '#f59e0b' },
                            { name: 'Cancelled', value: analytics.sessionStats.cancelled, color: '#ef4444' },
                            { name: 'In Progress', value: analytics.sessionStats.inProgress, color: '#8b5cf6' },
                          ].filter(item => item.value > 0).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Popular Subjects Bar Chart */}
              {analytics.subjectStats.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BookOpen className="h-5 w-5" />
                      Most Popular Subjects
                    </CardTitle>
                    <CardDescription>Subjects with the highest number of sessions</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={analytics.subjectStats}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={12} angle={-45} textAnchor="end" height={100} />
                        <YAxis fontSize={12} />
                        <Tooltip contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="sessions" fill="#9B1B30" name="Sessions" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-gradient-to-br from-blue-50 to-blue-100">
                  <CardContent className="p-6">
                    <div className="text-center">
                      <BookOpen className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                      <p className="text-sm font-medium text-muted-foreground">Total Students</p>
                      <p className="text-4xl font-bold text-blue-900 my-2">{analytics.overview.totalStudents}</p>
                      <p className="text-xs text-blue-700">Registered on platform</p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-purple-50 to-purple-100">
                  <CardContent className="p-6">
                    <div className="text-center">
                      <GraduationCap className="h-8 w-8 mx-auto mb-2 text-purple-600" />
                      <p className="text-sm font-medium text-muted-foreground">Total Tutors</p>
                      <p className="text-4xl font-bold text-purple-900 my-2">{analytics.overview.totalTutors}</p>
                      <p className="text-xs text-purple-700">
                        {analytics.overview.verifiedTutors} verified
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-50 to-green-100">
                  <CardContent className="p-6">
                    <div className="text-center">
                      <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-600" />
                      <p className="text-sm font-medium text-muted-foreground">Completed Sessions</p>
                      <p className="text-4xl font-bold text-green-900 my-2">{analytics.overview.completedSessions}</p>
                      <p className="text-xs text-green-700">
                        {analytics.overview.completionRate}% completion rate
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <AlertCircle className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium">No analytics data available</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Data will appear once there is activity on the platform
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* LEADERBOARD TAB */}
        <TabsContent value="leaderboard">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5" />
                Top Performing Tutors
              </CardTitle>
              <CardDescription className="mb-4">Ranked by overall performance score</CardDescription>

              {/* Full Width Centered Tabs */}
              <Tabs value={tutorRankingTab} onValueChange={(v: any) => setTutorRankingTab(v)}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger
                    value="overall"
                    className="data-[state=active]:bg-[#9B1B30] data-[state=active]:text-white"
                  >
                    Overall Best
                  </TabsTrigger>
                  <TabsTrigger
                    value="revenue"
                    className="data-[state=active]:bg-[#9B1B30] data-[state=active]:text-white"
                  >
                    Revenue
                  </TabsTrigger>
                  <TabsTrigger
                    value="sessions"
                    className="data-[state=active]:bg-[#9B1B30] data-[state=active]:text-white"
                  >
                    Sessions
                  </TabsTrigger>
                  <TabsTrigger
                    value="rating"
                    className="data-[state=active]:bg-[#9B1B30] data-[state=active]:text-white"
                  >
                    Rating
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {/* Ranking Info */}
              {tutorRankingTab === "overall" && (
                <div className="mb-4 p-3 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
                  <p className="text-sm font-medium mb-2">Overall Best Ranking Formula:</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <Badge variant="secondary" className="bg-purple-100">40% Rating</Badge>
                    <Badge variant="secondary" className="bg-blue-100">40% Sessions</Badge>
                    <Badge variant="secondary" className="bg-green-100">20% Completion Rate</Badge>
                  </div>
                </div>
              )}

              {tutorsLoading || allTutors.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#9B1B30]" />
                  <p className="text-sm text-muted-foreground mt-4">Loading tutor rankings...</p>
                </div>
              ) : rankedTutors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No tutors match the current filters</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {rankedTutors.map((tutor, index) => {
                    const stats = tutor.stats || {
                      averageRating: 0,
                      completedSessions: 0,
                      totalRevenue: 0,
                      reviewCount: 0
                    };

                    return (
                      <div
                        key={tutor.profile.id}
                        className={`p-3 border rounded-lg flex items-center gap-4 ${
                          index < 3 && tutorRankingTab === "overall"
                            ? "border-2 border-yellow-400 bg-yellow-50/30"
                            : "bg-muted/30"
                        }`}
                      >
                        {/* Rank Badge */}
                        <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold ${
                          index === 0 ? "bg-yellow-500 text-white text-lg" :
                          index === 1 ? "bg-gray-400 text-white text-lg" :
                          index === 2 ? "bg-orange-600 text-white text-lg" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`}
                        </div>

                        {/* Tutor Info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold">
                              {tutor.user?.firstName} {tutor.user?.lastName}
                            </p>
                            {tutor.profile.isVerified && (
                              <Badge variant="default" className="bg-green-600 h-5 text-xs">✓</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1" title={`${stats.reviewCount} reviews`}>
                              <CheckCircle className="h-3 w-3" />
                              {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : "N/A"}/5
                            </span>
                            <span className="flex items-center gap-1">
                              <BookOpen className="h-3 w-3" />
                              {stats.completedSessions} sessions
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              {formatMoney(stats.totalRevenue)}
                            </span>
                          </div>
                        </div>

                        {/* Score Badge */}
                        {tutorRankingTab === "overall" && (
                          <Badge variant="outline" className="bg-purple-100 font-bold">
                            {tutor.overallScore > 0 ? tutor.overallScore.toFixed(1) : "0.0"}
                          </Badge>
                        )}
                        {tutorRankingTab === "revenue" && (
                          <Badge variant="outline" className="bg-green-100 font-bold">
                            {formatMoney(stats.totalRevenue)}
                          </Badge>
                        )}
                        {tutorRankingTab === "sessions" && (
                          <Badge variant="outline" className="bg-blue-100 font-bold">
                            {stats.completedSessions}
                          </Badge>
                        )}
                        {tutorRankingTab === "rating" && (
                          <Badge variant="outline" className="bg-yellow-100 font-bold">
                            {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : "N/A"}⭐
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

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
                  <p className="text-lg font-medium">No pending tutor</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredPendingTutors.map((tutor) => (
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
                              {getTutorPricing(tutor)}
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
                              {formatDate(tutor.profile.createdAt)}
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
              <div className="flex gap-2">
                {unreadCount > 0 && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => markAllAsReadMutation.mutate()}
                    disabled={markAllAsReadMutation.isPending}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark All as Read
                  </Button>
                )}
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
              </div>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#9B1B30]" />
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No notifications yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredNotifications.map((notification) => {
                    const isPhoneViolation = notification.type === "PHONE_NUMBER_VIOLATION";
                    const notificationData = notification.data as any;

                    return (
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
                            {isPhoneViolation && notificationData?.messageContent && (
                              <div className="mt-2 p-2 bg-muted/50 rounded border border-border">
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  Blocked Message:
                                </p>
                                <p className="text-sm italic">"{notificationData.messageContent}"</p>
                              </div>
                            )}
                            <p className="text-xs text-muted-foreground mt-2">
                              {formatDateTime(notification.createdAt)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            {isPhoneViolation && notificationData?.senderId && notificationData?.senderRole && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const userType = notificationData.senderRole === "student" ? "student" : "tutor";
                                  const userName = notificationData.senderName || "User";

                                  if (userType === "student") {
                                    setStudentChatHistory({
                                      id: notificationData.senderId,
                                      name: userName,
                                    });
                                  } else {
                                    setTutorChatHistory({
                                      id: notificationData.senderId,
                                      name: userName,
                                    });
                                  }

                                  // Mark as read when clicked
                                  if (!notification.isRead) {
                                    markAsReadMutation.mutate(notification.id);
                                  }
                                }}
                              >
                                <MessageSquare className="h-4 w-4 mr-1" />
                                View Chat History
                              </Button>
                            )}
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
                      </div>
                    );
                  })}
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
              ) : filteredStudents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No students registered yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredStudents.map((student) => (
                    <div
                      key={student.id}
                      className="p-4 border rounded-lg flex items-center justify-between hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center space-x-3 flex-1">
                        <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center">
                          <User className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold">
                            {student.firstName} {student.lastName}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {student.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Joined {formatDate(student.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedStudent(student)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View Details
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setStudentChatHistory({
                            id: student.id,
                            name: `${student.firstName} ${student.lastName}`,
                          })}
                        >
                          <MessageSquare className="h-4 w-4 mr-1" />
                          Chat History
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
              ) : filteredAllTutors.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GraduationCap className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No tutors registered yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredAllTutors.map((tutor) => (
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
                              Joined {formatDate(tutor.profile.createdAt)}
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
                            {getTutorPricing(tutor)}
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
                          onClick={() => setSelectedTutor(tutor)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Profile
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedTutorForSessions(tutor)}
                        >
                          <Calendar className="h-4 w-4 mr-1" />
                          Sessions
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTutorChatHistory({
                            id: tutor.user?.id || "",
                            name: `${tutor.user?.firstName} ${tutor.user?.lastName}`,
                          })}
                        >
                          <MessageSquare className="h-4 w-4 mr-1" />
                          Chat History
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
              ) : filteredAdminUsers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p>No admin accounts found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredAdminUsers.map((admin) => (
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
                            Joined {formatDate(admin.createdAt)}
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
                      {getTutorPricing(selectedTutor)}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">
                      Application Date
                    </p>
                    <p className="text-base">
                      {formatDate(selectedTutor.profile.createdAt)}
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

      {/* Student Details Dialog */}
      <Dialog open={!!selectedStudent} onOpenChange={() => setSelectedStudent(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Student Details & Sessions</DialogTitle>
            <DialogDescription>
              Complete information and session history for {selectedStudent?.firstName} {selectedStudent?.lastName}
            </DialogDescription>
          </DialogHeader>
          {studentDetailsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#9B1B30]" />
            </div>
          ) : studentDetails ? (
            <div className="space-y-6">
              {/* Student Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Full Name</p>
                  <p className="text-base font-semibold">
                    {studentDetails.student.firstName} {studentDetails.student.lastName}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Email</p>
                  <p className="text-base">{studentDetails.student.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Joined</p>
                  <p className="text-base">
                    {formatDate(studentDetails.student.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Student ID</p>
                  <p className="text-base font-mono text-xs">{studentDetails.student.id}</p>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-blue-600">{studentDetails.stats.totalSessions}</p>
                    <p className="text-xs text-muted-foreground">Total Sessions</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{studentDetails.stats.completedSessions}</p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-orange-600">{studentDetails.stats.upcomingSessions}</p>
                    <p className="text-xs text-muted-foreground">Upcoming</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{studentDetails.stats.cancelledSessions}</p>
                    <p className="text-xs text-muted-foreground">Cancelled</p>
                  </CardContent>
                </Card>
              </div>

              {/* Sessions List */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Session History</h3>
                {studentDetails.sessions.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No sessions found</p>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {studentDetails.sessions.map((session: any) => (
                      <div key={session.id} className="p-3 border rounded-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium">{session.subject?.name || "Unknown Subject"}</p>
                              <Badge variant={
                                session.status === 'completed' ? 'default' :
                                session.status === 'scheduled' ? 'secondary' :
                                session.status === 'cancelled' ? 'destructive' : 'outline'
                              }>
                                {session.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Tutor: {session.tutor?.user?.firstName} {session.tutor?.user?.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {session.scheduledAt && formatDateTime(
                                session.scheduledAt?.toDate ? session.scheduledAt.toDate() : session.scheduledAt
                              )}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">
                              {formatMoney(session.priceCents ? session.priceCents / 100 : (session.price || 0))}
                            </p>
                            <p className="text-xs text-muted-foreground">{session.duration || 60} min</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground">Failed to load student details</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Tutor Sessions Dialog */}
      <Dialog open={!!selectedTutorForSessions} onOpenChange={() => setSelectedTutorForSessions(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tutor Sessions</DialogTitle>
            <DialogDescription>
              Session history for {selectedTutorForSessions?.user?.firstName} {selectedTutorForSessions?.user?.lastName}
            </DialogDescription>
          </DialogHeader>
          {tutorSessionsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#9B1B30]" />
            </div>
          ) : tutorSessions ? (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-blue-600">{tutorSessions.stats.totalSessions}</p>
                    <p className="text-xs text-muted-foreground">Total Sessions</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-600">{tutorSessions.stats.completedSessions}</p>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-orange-600">{tutorSessions.stats.upcomingSessions}</p>
                    <p className="text-xs text-muted-foreground">Upcoming</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-600">{tutorSessions.stats.cancelledSessions}</p>
                    <p className="text-xs text-muted-foreground">Cancelled</p>
                  </CardContent>
                </Card>
              </div>

              {/* Sessions List */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Session History</h3>
                {tutorSessions.sessions.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No sessions found</p>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {tutorSessions.sessions.map((session: any) => (
                      <div key={session.id} className="p-3 border rounded-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-medium">{session.subject?.name || "Unknown Subject"}</p>
                              <Badge variant={
                                session.status === 'completed' ? 'default' :
                                session.status === 'scheduled' ? 'secondary' :
                                session.status === 'cancelled' ? 'destructive' : 'outline'
                              }>
                                {session.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Student: {session.student?.firstName} {session.student?.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {session.scheduledAt && formatDateTime(
                                session.scheduledAt?.toDate ? session.scheduledAt.toDate() : session.scheduledAt
                              )}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold">
                              {formatMoney(session.priceCents ? session.priceCents / 100 : (session.price || 0))}
                            </p>
                            <p className="text-xs text-muted-foreground">{session.duration || 60} min</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground">Failed to load tutor sessions</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Student Chat History Dialog */}
      {studentChatHistory && (
        <ChatHistoryDialog
          userId={studentChatHistory.id}
          userType="student"
          userName={studentChatHistory.name}
          open={!!studentChatHistory}
          onOpenChange={(open) => !open && setStudentChatHistory(null)}
        />
      )}

      {/* Tutor Chat History Dialog */}
      {tutorChatHistory && (
        <ChatHistoryDialog
          userId={tutorChatHistory.id}
          userType="tutor"
          userName={tutorChatHistory.name}
          open={!!tutorChatHistory}
          onOpenChange={(open) => !open && setTutorChatHistory(null)}
        />
      )}
    </div>
  );
}
