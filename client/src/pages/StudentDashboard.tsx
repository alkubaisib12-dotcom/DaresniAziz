
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session, TutorProfile, User, Subject } from "@shared/schema";
import { useLocation } from "wouter";
import { formatMoney, formatFromCents } from "@/lib/currency";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { SessionCard } from "@/components/SessionCard";
import { ChatWindow } from "@/components/ChatWindow";
import StudyBuddyPanel from "@/components/study-buddy/StudyBuddyPanel";
import { MemoryMatchGame } from "@/components/MemoryMatchGame";

import { Calendar, Clock, CheckCircle, XCircle, AlertCircle, MessageCircle } from "lucide-react";
import { format } from "date-fns";

/* ------------------------------------------------------------ */
/* Helpers                                                      */
/* ------------------------------------------------------------ */

type SessionWithRelations = Session & {
  student: User;
  tutor: TutorProfile & { user: User };
  subject: Subject;
};

// Normalize Firestore Timestamp / string / number / Date into Date
function toDate(value: any): Date | null {
  try {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

    if (typeof value === "string" || typeof value === "number") {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === "object") {
      if (typeof (value as any).toDate === "function") {
        const d = (value as any).toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      }
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

function formatDateTime(ts: any): string {
  const d = toDate(ts);
  if (!d) return "TBD";
  return format(d, "MMM dd, yyyy 'at' h:mm a");
}

function formatShortDate(ts: any): string {
  const d = toDate(ts);
  if (!d) return "TBD";
  return format(d, "MMM dd, yyyy");
}

/* ------------------------------------------------------------ */
/* Component                                                    */
/* ------------------------------------------------------------ */

export default function StudentDashboard() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [activeTab, setActiveTab] = useState<string>("upcoming");
  const [showChat, setShowChat] = useState(false);
  const [chatUserId, setChatUserId] = useState<string | null>(null);
  const [showStudyBuddy, setShowStudyBuddy] = useState(false);
  const [showMemoryGame, setShowMemoryGame] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoading && !user) {
      toast({
        title: "Unauthorized",
        description: "Please sign in to view your dashboard.",
        variant: "destructive",
      });
      navigate("/", { replace: true });
    }
  }, [user, isLoading, toast, navigate]);

  // Listen for menu events to open Study Buddy and Memory Game
  useEffect(() => {
    const handleOpenStudyBuddy = () => setShowStudyBuddy(true);
    const handleOpenMemoryGame = () => setShowMemoryGame(true);

    window.addEventListener("open-study-buddy", handleOpenStudyBuddy);
    window.addEventListener("open-memory-game", handleOpenMemoryGame);

    return () => {
      window.removeEventListener("open-study-buddy", handleOpenStudyBuddy);
      window.removeEventListener("open-memory-game", handleOpenMemoryGame);
    };
  }, []);

  /* ---------------------- Sessions (via /api/sessions) ---------------------- */

  const {
    data: sessions,
    isLoading: sessionsLoading,
  } = useQuery<SessionWithRelations[]>({
    queryKey: ["/api/sessions"],
    enabled: !!user,
    retry: false,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  const sortedSessions = useMemo<SessionWithRelations[]>(() => {
    const list = Array.isArray(sessions) ? [...sessions] : [];
    list.sort((a, b) => {
      const aDate = toDate(a.scheduledAt);
      const bDate = toDate(b.scheduledAt);
      if (!aDate || !bDate) return 0;
      return aDate.getTime() - bDate.getTime();
    });
    return list;
  }, [sessions]);

  const pendingSessions = useMemo(() => {
    const now = new Date();
    return sortedSessions.filter((s) => {
      const dt = toDate(s.scheduledAt);
      return s.status === "pending" && dt !== null && dt > now;
    });
  }, [sortedSessions]);

  const upcomingSessions = useMemo(() => {
    const now = new Date();
    return sortedSessions.filter((s) => {
      const dt = toDate(s.scheduledAt);
      return s.status === "scheduled" && dt !== null && dt > now;
    });
  }, [sortedSessions]);

  const completedSessions = useMemo(
    () => sortedSessions.filter((s) => s.status === "completed"),
    [sortedSessions],
  );

  const cancelledSessions = useMemo(
    () => sortedSessions.filter((s) => s.status === "cancelled"),
    [sortedSessions],
  );

  const totalStudyMinutes = useMemo(
    () =>
      completedSessions.reduce((sum, s) => {
        const duration = typeof s.duration === "number" ? s.duration : 60;
        return sum + duration;
      }, 0),
    [completedSessions],
  );

  const totalStudyHours = useMemo(
    () => Math.round((totalStudyMinutes / 60) * 10) / 10,
    [totalStudyMinutes],
  );

  const tutorCount = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sortedSessions) {
      const id = s.tutor?.user?.id ?? s.tutorId;
      if (id) ids.add(id);
    }
    return ids.size;
  }, [sortedSessions]);

  const recentSessions = useMemo(
    () => completedSessions.slice(0, 3),
    [completedSessions],
  );

  const nextSession = useMemo(() => {
    if (upcomingSessions.length > 0) return upcomingSessions[0];
    if (pendingSessions.length > 0) return pendingSessions[0];
    return null;
  }, [upcomingSessions, pendingSessions]);

  const handleStartChat = (targetUserId?: string | null) => {
    if (!targetUserId) return;
    setChatUserId(targetUserId);
    setShowChat(true);
  };

  const renderSessionsList = (
    list: SessionWithRelations[],
    options: {
      emptyTitle: string;
      emptySubtitle?: string;
      emptyIcon: JSX.Element;
      showBrowseButton?: boolean;
    },
  ) => {
    if (sessionsLoading) {
      return (
        <div className="space-y-4 mt-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="h-20 bg-muted rounded" />
            </div>
          ))}
        </div>
      );
    }

    if (!list.length) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          {options.emptyIcon}
          <p className="font-medium">{options.emptyTitle}</p>
          {options.emptySubtitle && (
            <p className="text-sm mt-2">{options.emptySubtitle}</p>
          )}
          {options.showBrowseButton && (
            <Button
              className="mt-4"
              onClick={() => navigate("/tutors")}
              data-testid="button-browse-tutors"
            >
              Browse Tutors
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4 mt-4">
        {list.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            userRole="student"
            onChat={() => handleStartChat(session.tutor?.user?.id ?? session.tutorId)}
          />
        ))}
      </div>
    );
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1
            className="text-3xl font-bold text-foreground"
            data-testid="text-dashboard-title"
          >
            Welcome back, {user.firstName || "Student"}!
          </h1>
          <p className="text-muted-foreground mt-2">
            Track your sessions, stay on top of your learning, and connect with tutors.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Quick Stats */}
            <div className="grid md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6 text-center">
                  <div
                    className="text-2xl font-bold text-primary"
                    data-testid="text-pending-sessions"
                  >
                    {pendingSessions.length}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Pending Requests
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div
                    className="text-2xl font-bold text-primary"
                    data-testid="text-upcoming-sessions"
                  >
                    {upcomingSessions.length}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Upcoming Sessions
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div
                    className="text-2xl font-bold text-primary"
                    data-testid="text-completed-sessions"
                  >
                    {completedSessions.length}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Completed Sessions
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <div
                    className="text-2xl font-bold text-primary"
                    data-testid="text-total-tutors"
                  >
                    {tutorCount}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Tutors you worked with
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sessions Tabs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <i className="fas fa-calendar-alt mr-2 text-primary" />
                  Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid grid-cols-5 w-full">
                    <TabsTrigger value="pending">
                      Pending
                      {pendingSessions.length > 0 && (
                        <Badge variant="destructive" className="ml-2">
                          {pendingSessions.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="upcoming">
                      Upcoming
                    </TabsTrigger>
                    <TabsTrigger value="completed">
                      Completed
                    </TabsTrigger>
                    <TabsTrigger value="cancelled">
                      Cancelled
                    </TabsTrigger>
                    <TabsTrigger value="all">
                      All
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="pending">
                    {renderSessionsList(pendingSessions, {
                      emptyTitle: "No pending requests",
                      emptySubtitle:
                        "New session requests will appear here once a tutor responds.",
                      emptyIcon: (
                        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      ),
                    })}
                  </TabsContent>

                  <TabsContent value="upcoming">
                    {renderSessionsList(upcomingSessions, {
                      emptyTitle: "No upcoming sessions",
                      emptySubtitle:
                        "When a tutor accepts your request, your sessions will show up here.",
                      emptyIcon: (
                        <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      ),
                      showBrowseButton: true,
                    })}
                  </TabsContent>

                  <TabsContent value="completed">
                    {renderSessionsList(completedSessions, {
                      emptyTitle: "No completed sessions yet",
                      emptySubtitle: "Completed sessions will appear here.",
                      emptyIcon: (
                        <CheckCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      ),
                    })}
                  </TabsContent>

                  <TabsContent value="cancelled">
                    {renderSessionsList(cancelledSessions, {
                      emptyTitle: "No cancelled sessions",
                      emptySubtitle: "Cancelled or declined sessions will appear here.",
                      emptyIcon: (
                        <XCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      ),
                    })}
                  </TabsContent>

                  <TabsContent value="all">
                    {renderSessionsList(sortedSessions, {
                      emptyTitle: "You have no sessions yet",
                      emptySubtitle: "Book a tutor to schedule your first session.",
                      emptyIcon: (
                        <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      ),
                      showBrowseButton: true,
                    })}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  <Button
                    variant="outline"
                    className="h-20 text-left justify-start"
                    onClick={() => navigate("/tutors")}
                    data-testid="button-find-tutors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                        <i className="fas fa-search text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold">Find Tutors</div>
                        <div className="text-sm text-muted-foreground">
                          Browse and book a new tutor
                        </div>
                      </div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-20 text-left justify-start"
                    onClick={() => setActiveTab("completed")}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-accent/50 rounded-full flex items-center justify-center">
                        <i className="fas fa-history text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold">View History</div>
                        <div className="text-sm text-muted-foreground">
                          Review your previous sessions
                        </div>
                      </div>
                    </div>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Next Session */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Next Session</CardTitle>
              </CardHeader>
              <CardContent>
                {nextSession ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={nextSession.tutor.user.profileImageUrl ?? undefined} />
                        <AvatarFallback>
                          {nextSession.tutor.user.firstName?.[0]}
                          {nextSession.tutor.user.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">
                          {nextSession.subject.name} with {nextSession.tutor.user.firstName}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {nextSession.tutor.user.email}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{formatDateTime(nextSession.scheduledAt)}</span>
                      </div>
                      {nextSession.duration && (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span>{nextSession.duration} minutes</span>
                        </div>
                      )}
                    </div>

                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => handleStartChat(nextSession.tutor.user.id)}
                      data-testid="button-next-session-chat"
                    >
                      <i className="fas fa-comment mr-2" />
                      Message Tutor
                    </Button>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-4">
                    <Calendar className="h-10 w-10 mx-auto mb-3" />
                    <p className="text-sm font-medium">No upcoming sessions</p>
                    <p className="text-xs mt-1">
                      Book a tutor to schedule your first lesson.
                    </p>
                    <Button
                      className="mt-4"
                      size="sm"
                      onClick={() => navigate("/tutors")}
                    >
                      Browse Tutors
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentSessions.length > 0 ? (
                    recentSessions.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center space-x-3 text-sm"
                      >
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                          <CheckCircle className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {session.subject.name} with {session.tutor.user.firstName}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {formatShortDate(session.scheduledAt)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-muted-foreground py-4">
                      <i className="fas fa-history text-2xl mb-2" />
                      <p className="text-sm">No recent activity</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Chat Window */}
      {showChat && chatUserId && (
        <ChatWindow userId={chatUserId} onClose={() => setShowChat(false)} />
      )}

      {/* Floating Action Button for AI Study Buddy */}
      {!showStudyBuddy && (
        <Button
          onClick={() => setShowStudyBuddy(true)}
          className="fixed bottom-4 left-4 h-14 w-14 rounded-full shadow-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 z-40"
          size="icon"
          title="AI Study Buddy"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      )}

      {/* AI Study Buddy */}
      <StudyBuddyPanel
        isOpen={showStudyBuddy}
        onClose={() => setShowStudyBuddy(false)}
      />

      {/* Memory Match Game */}
      <MemoryMatchGame
        isOpen={showMemoryGame}
        onClose={() => setShowMemoryGame(false)}
      />
    </div>
  );
}
