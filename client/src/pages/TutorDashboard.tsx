// client/src/pages/TutorDashboard.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Session, TutorProfile, User, Subject } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { SessionCard } from "@/components/SessionCard";
import { ChatWindow } from "@/components/ChatWindow";
import { Switch } from "@/components/ui/switch";
import TutorAnalyticsSection from "@/components/TutorAnalyticsSection";
import PreSessionMemoryGame from "@/components/PreSessionMemoryGame";
import { useLocation } from "wouter";
import { Calendar, Clock, CheckCircle, XCircle, AlertCircle, Save, Trash2, Download } from "lucide-react";
import { format } from "date-fns";
import { formatMoney } from "@/lib/currency";

/** ---------- helpers ---------- */
type DayAvailability = { isAvailable: boolean; startTime: string; endTime: string };

const DAYS: Array<{ key: string; label: string }> = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

const emptyWeek = (): Record<string, DayAvailability> =>
  DAYS.reduce((acc, d) => {
    acc[d.key] = { isAvailable: false, startTime: "09:00", endTime: "17:00" };
    return acc;
  }, {} as Record<string, DayAvailability>);

/** Normalize Firestore Timestamp / string / number / Date into Date */
function toDate(value: any): Date | null {
  try {
    if (!value) return null;
    if (value instanceof Date) return value;

    if (typeof value === "string" || typeof value === "number") {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === "object") {
      // Firestore Timestamp with .toDate()
      if (typeof (value as any).toDate === "function") {
        const d = (value as any).toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      }
      // Serialized Timestamp {_seconds, _nanoseconds}
      if (typeof (value as any)._seconds === "number") {
        const d = new Date((value as any)._seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Robust approval normalizer (matches PendingApproval logic) */
function normBoolLike(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 || v === 2;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (["true", "1", "approved", "verify", "verified", "active", "enabled", "published"].includes(s)) return true;
    return ["approved", "verify", "active", "true", "1", "enabled", "published"].some((k) => s.includes(k));
  }
  if (v instanceof Date) return !isNaN(v.getTime());
  return false;
}

function isTutorApproved(profile: any): boolean {
  if (!profile) return false;
  if (normBoolLike(profile.isVerified)) return true;
  if (profile.verificationStatus === "approved") return true;
  if (normBoolLike(profile.isActive)) return true;
  if (normBoolLike(profile.approvedAt) || normBoolLike(profile.verifiedAt) || normBoolLike(profile.publishedAt)) return true;
  return false;
}

function formatDate(timestamp: any) {
  const date = toDate(timestamp);
  if (!date) return "TBD";
  return format(date, "MMM dd, yyyy 'at' h:mm a");
}

export default function TutorDashboard() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [showChat, setShowChat] = useState(false);
  const [chatUserId, setChatUserId] = useState<string | null>(null);
  const [previousSessionCount, setPreviousSessionCount] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<string>("pending");

  // Availability dialog state
  const [showAvailability, setShowAvailability] = useState(false);
  const [week, setWeek] = useState<Record<string, DayAvailability>>(emptyWeek());
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // Fetch schedule templates
  const { data: scheduleTemplates = [] } = useQuery<Array<{ id: string; name: string; availability: any; createdAt: any }>>({
    queryKey: ["/api/tutors/schedule-templates"],
    enabled: !!user && user.role === "tutor",
  });

  // redirect unauthenticated
  useEffect(() => {
    if (!isLoading && !user) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Redirecting…",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [user, isLoading, toast]);

  /** Sessions */
  const { data: sessions, isLoading: sessionsLoading } = useQuery<
    Array<Session & { student: User; tutor: TutorProfile & { user: User }; subject: Subject }>
  >({
    queryKey: ["/api/sessions"],
    enabled: !!user,
    retry: false,
    refetchInterval: 60000, // Optimized: 60s instead of 10s
    refetchOnWindowFocus: true,
    staleTime: 30000, // Cache for 30s
  });

  /** Tutor profile (no polling here; polling lives on PendingApproval page) */
  const { data: tutorProfile, isFetching: profileFetching } = useQuery<TutorProfile & { __approved?: boolean }>({
    queryKey: ["/api/tutors/profile"],
    enabled: !!user,
    retry: false,
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: 60000, // Optimized: 60s instead of 0
    select: (p: any) => (p ? { ...p, __approved: isTutorApproved(p) } : p),
  });

  const approved = !!tutorProfile?.__approved;

  /** Hard redirect gating:
   * - If tutor has no profile -> send to complete
   * - If tutor has profile but not approved -> send to pending page (which polls)
   */
  useEffect(() => {
    if (!isLoading && user?.role === "tutor") {
      if (!profileFetching && tutorProfile == null) {
        navigate("/complete-signup", { replace: true });
      } else if (!profileFetching && tutorProfile && !approved) {
        navigate("/pending-approval", { replace: true });
      }
    }
  }, [user?.role, isLoading, tutorProfile, approved, profileFetching, navigate]);

  /** Mutations */
  const updateSessionMutation = useMutation({
    mutationFn: async ({ sessionId, status }: { sessionId: string; status: string }) =>
      apiRequest(`/api/sessions/${sessionId}`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),
    onSuccess: async (_, variables) => {
      // Force refetch instead of just invalidate
      await queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
      toast({
        title: "Success",
        description:
          variables.status === "scheduled"
            ? "Session accepted successfully"
            : variables.status === "cancelled"
            ? "Session declined"
            : "Session updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveAvailabilityMutation = useMutation({
    mutationFn: async (payload: Record<string, DayAvailability>) =>
      apiRequest("/api/tutors/profile", {
        method: "PUT",
        body: JSON.stringify({ availability: payload }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tutors/profile"] });
      setShowAvailability(false);
      toast({ title: "Availability saved", description: "Your schedule has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async ({ name, availability }: { name: string; availability: any }) =>
      apiRequest("/api/tutors/schedule-templates", {
        method: "POST",
        body: JSON.stringify({ name, availability }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tutors/schedule-templates"] });
      setShowSaveTemplate(false);
      setTemplateName("");
      toast({ title: "Template saved", description: "Your schedule template has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string) =>
      apiRequest(`/api/tutors/schedule-templates/${templateId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tutors/schedule-templates"] });
      toast({ title: "Template deleted", description: "Schedule template has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Seed availability from server when profile loaded
  useEffect(() => {
    const tp: any = tutorProfile;
    if (tp?.availability) {
      const seeded = emptyWeek();
      const src = tp.availability as Record<string, any>;
      for (const k of Object.keys(src)) {
        if (seeded[k]) {
          seeded[k] = {
            isAvailable: !!src[k].isAvailable,
            startTime: src[k].startTime ?? "09:00",
            endTime: src[k].endTime ?? "17:00",
          };
        }
      }
      setWeek(seeded);
    }
  }, [tutorProfile]);

  /** Derived data - Categorize sessions */
  const pendingSessions = useMemo(
    () => {
      const now = new Date();
      return (Array.isArray(sessions) ? sessions : []).filter((s: any) => {
        const dt = toDate(s.scheduledAt);
        return s.status === "pending" && dt && dt > now;
      });
    },
    [sessions],
  );

  const upcomingSessions = useMemo(
    () => {
      const now = new Date();
      return (Array.isArray(sessions) ? sessions : []).filter((s: any) => {
        const dt = toDate(s.scheduledAt);
        return s.status === "scheduled" && dt && dt > now;
      });
    },
    [sessions],
  );

  const completedSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions : []).filter((s: any) => s.status === "completed"),
    [sessions],
  );

  const cancelledSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions : []).filter((s: any) => s.status === "cancelled"),
    [sessions],
  );

  const totalEarnings = useMemo(
    () =>
      completedSessions.reduce((sum: number, s: any) => {
        if (typeof s.priceCents === "number") return sum + s.priceCents / 100;
        if (typeof s.price === "string") return sum + parseFloat(s.price || "0");
        return sum;
      }, 0),
    [completedSessions],
  );

  // Booking toast for new sessions
  useEffect(() => {
    if (Array.isArray(sessions) && sessions.length > 0) {
      if (previousSessionCount > 0 && sessions.length > previousSessionCount) {
        const newCount = sessions.length - previousSessionCount;
        toast({
          title: "New Booking!",
          description: `You have ${newCount} new session booking${newCount > 1 ? "s" : ""}!`,
        });
      }
      setPreviousSessionCount(sessions.length);
    }
  }, [sessions, previousSessionCount, toast]);

  const handleStartChat = (userId: string) => {
    setChatUserId(userId);
    setShowChat(true);
  };

  const handleSessionAction = (sessionId: string, status: string) => {
    updateSessionMutation.mutate({ sessionId, status });
  };

  const handleAccept = (sessionId: string) => {
    updateSessionMutation.mutate({ sessionId, status: "scheduled" });
  };

  const handleReject = (sessionId: string) => {
    updateSessionMutation.mutate({ sessionId, status: "cancelled" });
  };

  const handleLoadTemplate = (template: any) => {
    const seeded = emptyWeek();
    const src = template.availability as Record<string, any>;
    for (const k of Object.keys(src)) {
      if (seeded[k]) {
        seeded[k] = {
          isAvailable: !!src[k].isAvailable,
          startTime: src[k].startTime ?? "09:00",
          endTime: src[k].endTime ?? "17:00",
        };
      }
    }
    setWeek(seeded);
    toast({
      title: "Template loaded",
      description: `Loaded schedule template: ${template.name}`,
    });
  };

  const handleSaveTemplate = () => {
    if (!templateName.trim()) {
      toast({
        title: "Template name required",
        description: "Please enter a name for this template",
        variant: "destructive",
      });
      return;
    }
    saveTemplateMutation.mutate({ name: templateName, availability: week });
  };

  /** Pending Session Card Component */
  const PendingSessionCard = ({ session }: { session: any }) => (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={session.student?.profileImageUrl} />
            <AvatarFallback>
              {session.student?.firstName?.[0]}
              {session.student?.lastName?.[0]}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">
                  {session.student?.firstName} {session.student?.lastName}
                </h3>
                <p className="text-sm text-muted-foreground">{session.student?.email}</p>
              </div>
              <Badge variant="secondary">Pending</Badge>
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{formatDate(session.scheduledAt)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{session.duration} minutes</span>
              </div>
              {session.subject && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{session.subject.name}</Badge>
                </div>
              )}
              {session.notes && (
                <div className="mt-2 p-3 bg-muted rounded-md">
                  <p className="text-sm font-medium">Student Notes:</p>
                  <p className="text-sm text-muted-foreground">{session.notes}</p>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                onClick={() => handleAccept(session.id)}
                disabled={updateSessionMutation.isPending}
                className="flex-1"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Accept
              </Button>
              <Button
                onClick={() => handleReject(session.id)}
                disabled={updateSessionMutation.isPending}
                variant="outline"
                className="flex-1"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Decline
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  /** Guards */
  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
      </div>
    );
  }

  // Tutor must be approved to view this dashboard. While redirects fire, don't render content.
  if (user.role === "tutor" && (!tutorProfile || !approved)) {
    return null;
  }

  /** -------- Approved tutor: full dashboard -------- */
  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground" data-testid="text-dashboard-title">
            Welcome, {user.firstName || "Tutor"}!
          </h1>
          <p className="text-muted-foreground mt-2">Manage your tutoring sessions and students</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Quick Stats */}
            <div className="grid md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="text-2xl font-bold text-primary" data-testid="text-pending-sessions">
                    {pendingSessions.length}
                  </div>
                  <div className="text-sm text-muted-foreground">Pending Requests</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="text-2xl font-bold text-primary" data-testid="text-upcoming-sessions">
                    {upcomingSessions.length}
                  </div>
                  <div className="text-sm text-muted-foreground">Upcoming Sessions</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="text-2xl font-bold text-primary" data-testid="text-completed-sessions">
                    {completedSessions.length}
                  </div>
                  <div className="text-sm text-muted-foreground">Completed Sessions</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="text-2xl font-bold text-primary" data-testid="text-total-earnings">
{formatMoney(totalEarnings)}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Earnings</div>
                </CardContent>
              </Card>
            </div>

            {/* Sessions Tabs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <i className="fas fa-calendar-alt mr-2 text-primary"></i>
                  Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid grid-cols-4 w-full">
                    <TabsTrigger value="pending">
                      Pending
                      {pendingSessions.length > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          {pendingSessions.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                    <TabsTrigger value="completed">Completed</TabsTrigger>
                    <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
                  </TabsList>

                  <TabsContent value="pending" className="space-y-4 mt-4">
                    {sessionsLoading ? (
                      <div className="space-y-4">
                        {[...Array(3)].map((_, i) => (
                          <div key={i} className="animate-pulse">
                            <div className="h-32 bg-muted rounded"></div>
                          </div>
                        ))}
                      </div>
                    ) : pendingSessions.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="font-medium">No pending requests</p>
                        <p className="text-sm mt-2">New session requests will appear here</p>
                      </div>
                    ) : (
                      pendingSessions.map((session: any) => (
                        <div key={session.id}>
                          <SessionCard
                            session={session}
                            userRole="tutor"
                            onChat={() => handleStartChat(session.studentId)}
                            onAction={(action) => handleSessionAction(session.id, action)}
                          />
                          {/* Accept/Decline buttons for pending sessions */}
                          <div className="mt-2 flex gap-2 px-4">
                            <Button
                              onClick={() => handleAccept(session.id)}
                              disabled={updateSessionMutation.isPending}
                              className="flex-1"
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Accept
                            </Button>
                            <Button
                              onClick={() => handleReject(session.id)}
                              disabled={updateSessionMutation.isPending}
                              variant="outline"
                              className="flex-1"
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              Decline
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="upcoming" className="space-y-4 mt-4">
                    {sessionsLoading ? (
                      <div className="space-y-4">
                        {[...Array(3)].map((_, i) => (
                          <div key={i} className="animate-pulse">
                            <div className="h-20 bg-muted rounded"></div>
                          </div>
                        ))}
                      </div>
                    ) : upcomingSessions.length > 0 ? (
                      upcomingSessions.map((session: any) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          userRole="tutor"
                          onChat={() => handleStartChat(session.studentId)}
                          onAction={(action) => handleSessionAction(session.id, action)}
                        />
                      ))
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="font-medium">No upcoming sessions</p>
                        <p className="text-sm mt-2">Accepted sessions will appear here</p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="completed" className="space-y-4 mt-4">
                    {completedSessions.length > 0 ? (
                      completedSessions.map((session: any) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          userRole="tutor"
                          onChat={() => handleStartChat(session.studentId)}
                          onAction={(action) => handleSessionAction(session.id, action)}
                        />
                      ))
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <CheckCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="font-medium">No completed sessions yet</p>
                        <p className="text-sm mt-2">Completed sessions will appear here</p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="cancelled" className="space-y-4 mt-4">
                    {cancelledSessions.length > 0 ? (
                      cancelledSessions.map((session: any) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          userRole="tutor"
                          onChat={() => handleStartChat(session.studentId)}
                          onAction={(action) => handleSessionAction(session.id, action)}
                        />
                      ))
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        <XCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="font-medium">No cancelled sessions</p>
                        <p className="text-sm mt-2">Declined sessions will appear here</p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Profile Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Profile Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-center">
                    <img
                      src={
                        user.profileImageUrl ||
                        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=100&h=100"
                      }
                      alt={user.firstName || "User"}
                      className="w-20 h-20 rounded-full object-cover mx-auto mb-3"
                    />
                    <h3 className="font-semibold">
                      {user.firstName} {user.lastName}
                    </h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      <i className="fas fa-check-circle mr-1"></i>
                      Verified
                    </Badge>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Hourly Rate:</span>
<span className="font-medium">
  {formatMoney((tutorProfile as any)?.hourlyRate ?? 0)}/hr
</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Students:</span>
                      <span className="font-medium" data-testid="text-total-students">
                        {Array.isArray(sessions) ? new Set(sessions.map((s: any) => s.studentId)).size : 0}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Reviews:</span>
                      <span className="font-medium">{(tutorProfile as any)?.totalReviews ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rating:</span>
                      <span className="font-medium">{(0).toFixed(1)}/5</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => navigate("/profile-settings")}
                    data-testid="button-edit-profile"
                  >
                    <i className="fas fa-edit mr-2"></i>
                    Edit Profile
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setShowAvailability(true)}
                    data-testid="button-manage-availability"
                  >
                    <i className="fas fa-calendar mr-2"></i>
                    Manage Availability
                  </Button>

                  <Button variant="outline" className="w-full justify-start" data-testid="button-view-earnings" onClick={() => navigate("/tutor-earnings")}> 
                    <i className="fas fa-chart-line mr-2"></i>
                    View Earnings
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* This Week */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">This Week</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {upcomingSessions.slice(0, 5).map((session: any) => {
                    const dt = toDate(session.scheduledAt);
                    return (
                      <div key={session.id} className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-primary rounded-full"></div>
                        <div className="flex-1">
                          <div className="font-medium">{session.subject.name}</div>
                          <div className="text-muted-foreground">
                            {dt ? dt.toLocaleDateString() : "TBD"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {upcomingSessions.length === 0 && (
                    <div className="text-center text-muted-foreground py-4">
                      <i className="fas fa-calendar-check text-2xl mb-2"></i>
                      <p className="text-sm">No sessions this week</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Enhanced Analytics Section */}
        <div className="mt-12">
          <TutorAnalyticsSection sessions={Array.isArray(sessions) ? sessions : []} />
        </div>
      </div>

      {/* Manage Availability Dialog */}
      <Dialog open={showAvailability} onOpenChange={setShowAvailability}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Availability</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Schedule Templates */}
            {scheduleTemplates.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Saved Templates</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSaveTemplate(!showSaveTemplate)}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Current
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {scheduleTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between p-2 border rounded-md bg-secondary/50"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleLoadTemplate(template)}
                        className="flex-1 justify-start"
                      >
                        <Download className="h-3 w-3 mr-2" />
                        {template.name}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTemplateMutation.mutate(template.id)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save template form */}
            {showSaveTemplate && (
              <div className="p-3 border rounded-lg bg-secondary/30 space-y-2">
                <Label htmlFor="template-name">Template Name</Label>
                <div className="flex gap-2">
                  <Input
                    id="template-name"
                    placeholder="e.g., My Regular Schedule"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                  <Button
                    onClick={handleSaveTemplate}
                    disabled={saveTemplateMutation.isPending}
                    size="sm"
                  >
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowSaveTemplate(false);
                      setTemplateName("");
                    }}
                    size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {scheduleTemplates.length === 0 && !showSaveTemplate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSaveTemplate(true)}
                className="w-full"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Current Schedule as Template
              </Button>
            )}

            {/* quick presets */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const next = emptyWeek();
                  for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
                    next[d] = { isAvailable: true, startTime: "09:00", endTime: "17:00" };
                  }
                  setWeek(next);
                }}
              >
                Mon–Fri 09:00–17:00
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeek(emptyWeek())}>
                Clear All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const mon = week["monday"];
                  const next = emptyWeek();
                  for (const d of DAYS.map((x) => x.key)) next[d] = { ...mon };
                  setWeek(next);
                }}
              >
                Copy Monday to All
              </Button>
            </div>

            {/* day grid */}
            <div className="grid grid-cols-1 gap-3">
              {DAYS.map((d) => {
                const v = week[d.key];
                return (
                  <div key={d.key} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={v.isAvailable}
                        onCheckedChange={(checked) =>
                          setWeek((s) => ({ ...s, [d.key]: { ...s[d.key], isAvailable: checked } }))
                        }
                      />
                      <span className="w-12 font-medium">{d.label}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">From</span>
                        <Input
                          type="time"
                          value={v.startTime}
                          disabled={!v.isAvailable}
                          onChange={(e) =>
                            setWeek((s) => ({ ...s, [d.key]: { ...s[d.key], startTime: e.target.value } }))
                          }
                          className="w-28"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">To</span>
                        <Input
                          type="time"
                          value={v.endTime}
                          disabled={!v.isAvailable}
                          onChange={(e) =>
                            setWeek((s) => ({ ...s, [d.key]: { ...s[d.key], endTime: e.target.value } }))
                          }
                          className="w-28"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAvailability(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  for (const k of Object.keys(week)) {
                    const d = week[k];
                    if (d.isAvailable && d.startTime >= d.endTime) {
                      toast({
                        title: "Invalid time range",
                        description: `On ${k}, end time must be after start time.`,
                        variant: "destructive",
                      });
                      return;
                    }
                  }
                  saveAvailabilityMutation.mutate(week);
                }}
                disabled={saveAvailabilityMutation.isPending}
              >
                {saveAvailabilityMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showChat && chatUserId && <ChatWindow userId={chatUserId} onClose={() => setShowChat(false)} />}

      {/* Memory Match Game - has its own floating button */}
      <PreSessionMemoryGame />
    </div>
  );
}
