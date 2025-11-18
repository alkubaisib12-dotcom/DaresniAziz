// src/pages/MySessions.tsx
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, User as UserIcon, Video, BookOpen } from "lucide-react";

import { fetchSessions, ApiSession } from "@/lib/api";
import { formatMoney } from "@/lib/currency";

// -------- Helpers --------
function coerceToDate(v: any): Date {
  if (!v) return new Date(NaN);
  // server may return ISO string
  if (typeof v === "string") return new Date(v);
  // Firestore Timestamp serialized
  if (typeof v === "object" && typeof v._seconds === "number") {
    return new Date(v._seconds * 1000);
  }
  // already Date
  if (v instanceof Date) return v;
  // fallback
  return new Date(v);
}

function statusColor(status: ApiSession["status"]) {
  switch (status) {
    case "scheduled":
      return "bg-blue-100 text-blue-800";
    case "in_progress":
      return "bg-green-100 text-green-800";
    case "completed":
      return "bg-gray-100 text-gray-800";
    case "cancelled":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function subjectFAIcon(name?: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("math")) return "fa-calculator";
  if (n.includes("science")) return "fa-flask";
  if (n.includes("english")) return "fa-book";
  if (n.includes("program") || n.includes("computer")) return "fa-code";
  if (n.includes("history")) return "fa-landmark";
  if (n.includes("art")) return "fa-palette";
  return "fa-graduation-cap";
}

// Local UI type after hydration (from server payload)
type HydratedSession = {
  id: string;
  status: ApiSession["status"];
  scheduledAt: Date;
  duration: number;
  meetingLink?: string | null;
  notes?: string;
  priceCents?: number;
  subjectName: string;
  counterpartName: string; // Tutor name for students, Student name for tutors
};

export default function MySessions() {
  const { user } = useAuth();

  const { data: hydrated = [], isLoading } = useQuery<HydratedSession[]>({
    queryKey: ["my-sessions", user?.id, user?.role],
    enabled: !!user?.id,
    staleTime: 15_000,
    queryFn: async () => {
      const raw = await fetchSessions(100);

      // Map server response directly to UI
      return raw.map<HydratedSession>((s) => {
        const dt = coerceToDate(s.scheduledAt);
        const subjName = s.subject?.name ?? s.subjectId;

        let counterpart = "";
        if (user?.role === "tutor") {
          const st = s.student;
          counterpart = [st?.firstName, st?.lastName].filter(Boolean).join(" ") || "Student";
        } else {
          // student view (default)
          const tutUser = s.tutor?.user;
          counterpart = [tutUser?.firstName, tutUser?.lastName].filter(Boolean).join(" ") || "Tutor";
        }

        return {
          id: s.id,
          status: s.status,
          scheduledAt: dt,
          duration: s.duration ?? 60,
          meetingLink: s.meetingLink ?? null,
          notes: s.notes ?? "",
          priceCents: s.priceCents,
          subjectName: subjName,
          counterpartName: counterpart,
        };
      });
    },
  });

  const { upcoming, past, cancelled } = useMemo(() => {
    const now = new Date();
    const up = hydrated.filter((s) => s.status === "scheduled" && s.scheduledAt > now);
    const pa = hydrated.filter(
      (s) => s.status === "completed" || (s.status === "scheduled" && s.scheduledAt <= now)
    );
    const ca = hydrated.filter((s) => s.status === "cancelled");
    return { upcoming: up, past: pa, cancelled: ca };
  }, [hydrated]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 mt-16">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 mt-16">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="title-my-sessions">
          My Sessions
        </h1>
        <p className="text-muted-foreground">View and manage your tutoring sessions</p>
      </div>

      {/* Upcoming */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <Calendar className="h-6 w-6" />
          Upcoming Sessions
          <Badge variant="secondary">{upcoming.length}</Badge>
        </h2>

        {upcoming.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground" data-testid="text-no-upcoming">
                No upcoming sessions scheduled
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {upcoming.map((s) => (
              <Card key={s.id} className="hover:shadow-md transition-shadow" data-testid={`session-card-${s.id}`}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                        <i className={`fas ${subjectFAIcon(s.subjectName)} text-primary text-xl`} />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-lg" data-testid={`text-session-subject-${s.id}`}>
                            {s.subjectName}
                          </h3>
                          <Badge className={statusColor(s.status)}>{s.status.replace("_", " ")}</Badge>
                        </div>

                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <UserIcon className="h-4 w-4" />
                            <span data-testid={`text-session-participant-${s.id}`}>
                              {user?.role === "tutor" ? `Student: ${s.counterpartName}` : `Tutor: ${s.counterpartName}`}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span data-testid={`text-session-time-${s.id}`}>
                              {format(s.scheduledAt, "PPP • p")} • {s.duration} min
                            </span>
                          </div>

                          {typeof s.priceCents === "number" && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span>{formatMoney(s.priceCents / 100)}</span>
                            </div>
                          )}
                        </div>

                        {s.notes && <p className="mt-3 text-sm text-muted-foreground italic">"{s.notes}"</p>}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      {s.meetingLink && (
                        <Button size="sm" asChild data-testid={`button-join-${s.id}`}>
                          <a href={s.meetingLink} target="_blank" rel="noopener noreferrer">
                            <Video className="h-4 w-4 mr-2" />
                            Join
                          </a>
                        </Button>
                      )}
                      <Button variant="outline" size="sm" data-testid={`button-details-${s.id}`}>
                        Details
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Past */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
          <BookOpen className="h-6 w-6" />
          Past Sessions
          <Badge variant="secondary">{past.length}</Badge>
        </h2>
        {past.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground" data-testid="text-no-past">
                No past sessions
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {past.slice(0, 5).map((s) => (
              <Card key={s.id} className="opacity-75" data-testid={`past-session-card-${s.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                        <i className={`fas ${subjectFAIcon(s.subjectName)} text-muted-foreground`} />
                      </div>
                      <div>
                        <h4 className="font-medium">{s.subjectName}</h4>
                        <p className="text-sm text-muted-foreground">{format(s.scheduledAt, "PP")}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusColor(s.status)}>
                      {s.status.replace("_", " ")}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Cancelled */}
      {cancelled.length > 0 && (
        <div>
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <i className="fas fa-ban" />
            Cancelled Sessions
            <Badge variant="secondary">{cancelled.length}</Badge>
          </h2>
          <div className="space-y-4">
            {cancelled.slice(0, 3).map((s) => (
              <Card key={s.id} className="opacity-60" data-testid={`cancelled-session-card-${s.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                        <i className={`fas ${subjectFAIcon(s.subjectName)} text-muted-foreground`} />
                      </div>
                      <div>
                        <h4 className="font-medium">{s.subjectName}</h4>
                        <p className="text-sm text-muted-foreground">{format(s.scheduledAt, "PP")}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-red-100 text-red-800">
                      Cancelled
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
