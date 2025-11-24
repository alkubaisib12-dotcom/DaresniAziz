// client/src/pages/StudentReports.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSessions } from "@/lib/api";
import type { ApiSession } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionQuizDialog } from "@/components/SessionQuizDialog";

// Helper to normalize Firestore timestamps
function normalizeDate(raw: any): Date {
  try {
    if (!raw) return new Date();
    if (raw instanceof Date) return isNaN(raw.getTime()) ? new Date() : raw;
    if (typeof raw === "object" && typeof raw.toDate === "function") {
      const d = raw.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
    }
    if (typeof raw === "object" && typeof raw._seconds === "number") {
      return new Date(raw._seconds * 1000);
    }
    if (typeof raw === "string" || typeof raw === "number") {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  } catch {
    return new Date();
  }
}

export default function StudentReports() {
  const { data: sessions, isLoading, error } = useQuery({
    queryKey: ["/api/my-sessions"],
    queryFn: () => fetchSessions(),
  });

  // Filter completed sessions with AI summaries
  const sessionsWithSummaries = sessions?.filter(
    (session) => session.status === "completed" && session.aiSummary
  ) || [];

  // Sort by date (most recent first)
  const sortedSessions = [...sessionsWithSummaries].sort((a, b) => {
    const dateA = normalizeDate(a.scheduledAt);
    const dateB = normalizeDate(b.scheduledAt);
    return dateB.getTime() - dateA.getTime();
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pt-20">
        <div className="container mx-auto py-8 px-4">
          <h1 className="text-3xl font-bold mb-6">My Lesson Reports</h1>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background pt-20">
        <div className="container mx-auto py-8 px-4">
          <h1 className="text-3xl font-bold mb-6">My Lesson Reports</h1>
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load reports. Please try again later.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pt-20">
      <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">My Lesson Reports</h1>
        <p className="text-muted-foreground">
          View AI-generated summaries of your completed tutoring sessions
        </p>
      </div>

      {sortedSessions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                <i className="fas fa-file-alt text-3xl text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-lg mb-1">No Reports Yet</h3>
                <p className="text-sm text-muted-foreground">
                  Your lesson summaries will appear here after your tutor completes them
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedSessions.map((session) => (
            <LessonReportCard key={session.id} session={session} />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

function LessonReportCard({ session }: { session: ApiSession }) {
  const [showQuizDialog, setShowQuizDialog] = useState(false);
  const scheduledDate = normalizeDate(session.scheduledAt);
  const generatedDate = session.aiSummary?.generatedAt
    ? normalizeDate(session.aiSummary.generatedAt)
    : null;

  return (
    <>
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-xl flex items-center gap-2">
              <i className="fas fa-graduation-cap text-primary" />
              {session.subject?.name || "Session"}
            </CardTitle>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <i className="fas fa-user-tie text-xs" />
                {session.tutor?.user?.firstName} {session.tutor?.user?.lastName}
              </span>
              <span className="flex items-center gap-1">
                <i className="fas fa-calendar text-xs" />
                {format(scheduledDate, "MMM dd, yyyy")}
              </span>
              <span className="flex items-center gap-1">
                <i className="fas fa-clock text-xs" />
                {session.duration || 60} minutes
              </span>
            </div>
          </div>
          <Badge className="bg-blue-100 text-blue-800 border-blue-200">
            <i className="fas fa-sparkles mr-1" />
            AI Summary
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* What Was Learned */}
        <div>
          <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <i className="fas fa-lightbulb text-green-600 text-sm" />
            </div>
            What You Learned
          </h3>
          <div className="ml-10 text-muted-foreground whitespace-pre-wrap">
            {session.aiSummary?.whatWasLearned || "No summary available"}
          </div>
        </div>

        {/* Strengths */}
        <div>
          <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <i className="fas fa-star text-blue-600 text-sm" />
            </div>
            Your Strengths
          </h3>
          <div className="ml-10 text-muted-foreground whitespace-pre-wrap">
            {session.aiSummary?.strengths || "No summary available"}
          </div>
        </div>

        {/* Areas for Improvement */}
        <div>
          <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center">
              <i className="fas fa-exclamation-triangle text-yellow-600 text-sm" />
            </div>
            Areas for Improvement
          </h3>
          <div className="ml-10 text-muted-foreground whitespace-pre-wrap">
            {session.aiSummary?.mistakes || "No summary available"}
          </div>
        </div>

        {/* Practice Tasks */}
        <div>
          <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <i className="fas fa-tasks text-purple-600 text-sm" />
            </div>
            Practice Tasks
          </h3>
          <div className="ml-10 text-muted-foreground whitespace-pre-wrap">
            {session.aiSummary?.practiceTasks || "No tasks assigned"}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Session ID: {session.id.slice(0, 8)}</span>
              {generatedDate && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <i className="fas fa-clock" />
                  Summary generated on {format(generatedDate, "MMM dd, yyyy 'at' HH:mm")}
                </span>
              )}
            </div>
            <Button
              onClick={() => setShowQuizDialog(true)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              <i className="fas fa-clipboard-question mr-2" />
              Take Improvement Quiz
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Quiz Dialog */}
    <SessionQuizDialog
      sessionId={session.id}
      open={showQuizDialog}
      onOpenChange={setShowQuizDialog}
    />
    </>
  );
}
