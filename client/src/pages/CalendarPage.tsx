import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, momentLocalizer } from "react-big-calendar";
import moment from "moment";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/currency";
import { useAuth } from "@/components/AuthProvider";

const localizer = momentLocalizer(moment);

interface Session {
  id: string;
  scheduledAt: Date;
  scheduledDate?: Date;
  duration: number;
  status: string;
  subject: {
    name: string;
  };
  tutor?: {
    user: {
      firstName: string;
      lastName: string;
    };
  };
  student?: {
    firstName: string;
    lastName: string;
  };
  meetingLink?: string;
  priceCents?: number;
  price?: number;
  aiSummary?: any;
  notes?: string;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: Session;
  status: string;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // Fetch sessions
  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
  });

  // Convert sessions to calendar events
  const events: CalendarEvent[] = sessions.map((session) => {
    try {
      const scheduledAt = session.scheduledDate || session.scheduledAt;
      const start = new Date(scheduledAt);
      const end = new Date(start.getTime() + (session.duration || 60) * 60 * 1000);

      const otherPerson = user?.role === "student"
        ? `${session.tutor?.user?.firstName || ""} ${session.tutor?.user?.lastName || ""}`.trim() || "Unknown"
        : `${session.student?.firstName || ""} ${session.student?.lastName || ""}`.trim() || "Unknown";

      return {
        id: session.id,
        title: `${session.subject?.name || "Session"} - ${otherPerson}`,
        start,
        end,
        resource: session,
        status: session.status,
      };
    } catch (error) {
      console.error("Error processing session for calendar:", session, error);
      return null;
    }
  }).filter((event): event is CalendarEvent => event !== null);

  console.log("Calendar sessions:", sessions.length, "Calendar events:", events.length);

  // Event style getter - color code by status
  const eventStyleGetter = (event: CalendarEvent) => {
    let backgroundColor = "#3b82f6"; // blue for scheduled
    let borderColor = "#2563eb";

    switch (event.status) {
      case "completed":
        backgroundColor = "#10b981"; // green
        borderColor = "#059669";
        break;
      case "cancelled":
        backgroundColor = "#ef4444"; // red
        borderColor = "#dc2626";
        break;
      case "in_progress":
        backgroundColor = "#f59e0b"; // orange
        borderColor = "#d97706";
        break;
    }

    return {
      style: {
        backgroundColor,
        borderColor,
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: "4px",
        opacity: 0.9,
        color: "white",
        border: "none",
        display: "block",
      },
    };
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  // Day prop getter - highlight days with sessions
  const dayPropGetter = (date: Date) => {
    const dateStr = moment(date).format("YYYY-MM-DD");

    // Find all sessions on this day
    const sessionsOnDay = events.filter((event) => {
      const eventDateStr = moment(event.start).format("YYYY-MM-DD");
      return eventDateStr === dateStr;
    });

    if (sessionsOnDay.length === 0) {
      return {};
    }

    // Check if there are any upcoming sessions (scheduled or in_progress)
    const hasUpcoming = sessionsOnDay.some(
      (event) => event.status === "scheduled" || event.status === "in_progress"
    );

    // Check if there are completed sessions
    const hasCompleted = sessionsOnDay.some((event) => event.status === "completed");

    // Priority: upcoming sessions (blue) > completed sessions (green)
    let backgroundColor = "";
    if (hasUpcoming) {
      backgroundColor = "#dbeafe"; // light blue
    } else if (hasCompleted) {
      backgroundColor = "#d1fae5"; // light green
    }

    return {
      style: {
        backgroundColor,
        fontWeight: "bold",
      },
    };
  };

  const priceValue =
    selectedEvent?.resource.priceCents != null
      ? Number(selectedEvent.resource.priceCents) / 100
      : selectedEvent?.resource.price != null
      ? Number(selectedEvent.resource.price)
      : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading calendar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">My Sessions Calendar</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                View all your tutoring sessions in calendar format
              </p>
            </div>
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-500 rounded"></div>
                <span>Scheduled</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span>Completed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-orange-500 rounded"></div>
                <span>In Progress</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-500 rounded"></div>
                <span>Cancelled</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ height: "600px" }}>
            <Calendar
              localizer={localizer}
              events={events}
              startAccessor="start"
              endAccessor="end"
              style={{ height: "100%" }}
              onSelectEvent={handleSelectEvent}
              eventPropGetter={eventStyleGetter}
              dayPropGetter={dayPropGetter}
              views={["month", "week", "day", "agenda"]}
              defaultView="month"
              popup
            />
          </div>
        </CardContent>
      </Card>

      {/* Session Details Modal */}
      <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{selectedEvent?.resource.subject.name}</span>
              <Badge
                className={
                  selectedEvent?.status === "completed"
                    ? "bg-green-600"
                    : selectedEvent?.status === "cancelled"
                    ? "bg-red-600"
                    : selectedEvent?.status === "in_progress"
                    ? "bg-orange-600"
                    : "bg-blue-600"
                }
              >
                {selectedEvent?.status}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {selectedEvent && (
            <div className="space-y-4">
              {/* Session Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Session Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {user?.role === "student" ? "Tutor" : "Student"}:
                    </span>
                    <span className="font-medium">
                      {user?.role === "student"
                        ? `${selectedEvent.resource.tutor?.user.firstName} ${selectedEvent.resource.tutor?.user.lastName}`
                        : `${selectedEvent.resource.student?.firstName} ${selectedEvent.resource.student?.lastName}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date:</span>
                    <span className="font-medium">
                      {moment(selectedEvent.start).format("MMMM D, YYYY")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Time:</span>
                    <span className="font-medium">
                      {moment(selectedEvent.start).format("h:mm A")} -{" "}
                      {moment(selectedEvent.end).format("h:mm A")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-medium">
                      {selectedEvent.resource.duration} minutes
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Price:</span>
                    <span className="font-medium">{formatMoney(priceValue)}</span>
                  </div>
                  {selectedEvent.resource.meetingLink && (
                    <div className="pt-2">
                      <Button
                        className="w-full"
                        onClick={() =>
                          window.open(selectedEvent.resource.meetingLink, "_blank")
                        }
                      >
                        <i className="fas fa-video mr-2"></i>
                        Join Meeting
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Notes */}
              {selectedEvent.resource.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedEvent.resource.notes}</p>
                  </CardContent>
                </Card>
              )}

              {/* AI Summary for completed sessions */}
              {selectedEvent.status === "completed" &&
                selectedEvent.resource.aiSummary && (
                  <Card className="border-blue-200 bg-blue-50">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <i className="fas fa-sparkles text-blue-600"></i>
                        AI Lesson Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <i className="fas fa-book-open text-green-600"></i>
                          What Was Learned
                        </h4>
                        <p className="text-sm">
                          {selectedEvent.resource.aiSummary.whatWasLearned}
                        </p>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <i className="fas fa-exclamation-triangle text-orange-600"></i>
                          Common Mistakes
                        </h4>
                        <p className="text-sm">
                          {selectedEvent.resource.aiSummary.mistakes}
                        </p>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <i className="fas fa-star text-yellow-600"></i>
                          Strengths
                        </h4>
                        <p className="text-sm">
                          {selectedEvent.resource.aiSummary.strengths}
                        </p>
                      </div>

                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <i className="fas fa-tasks text-blue-600"></i>
                          Practice Tasks
                        </h4>
                        <p className="text-sm">
                          {selectedEvent.resource.aiSummary.practiceTasks}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

              {/* Download Calendar */}
              {(selectedEvent.status === "scheduled" ||
                selectedEvent.status === "in_progress") && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    try {
                      const response = await fetch(
                        `/api/sessions/${selectedEvent.id}/calendar.ics`,
                        {
                          credentials: "include",
                        }
                      );
                      if (!response.ok) {
                        console.error("Failed to download calendar file");
                        return;
                      }
                      const blob = await response.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `session-${selectedEvent.id}.ics`;
                      document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      document.body.removeChild(a);
                    } catch (error) {
                      console.error("Error downloading calendar file:", error);
                    }
                  }}
                >
                  <i className="fas fa-calendar-plus mr-2"></i>
                  Add to My Calendar
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
