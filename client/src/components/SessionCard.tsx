// client/src/components/SessionCard.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { format } from "date-fns";
import { formatMoney } from "@/lib/currency";
import { LessonSummaryDialog } from "./LessonSummaryDialog";

interface SessionCardProps {
  session: any;
  userRole: "student" | "tutor";
  onChat?: () => void;
  /**
   * Actions fired by the card:
   * - "request_cancel"  -> user started a cancel request
   * - "accept_cancel"   -> user agreed to cancel
   * - "reject_cancel"   -> user declined the cancel request
   */
  onAction?: (action: string) => void;
}

// Safely normalize various date shapes (Date, Firestore Timestamp, string, number)
function normalizeDate(raw: any): Date {
  try {
    if (!raw) return new Date();

    if (raw instanceof Date) {
      return isNaN(raw.getTime()) ? new Date() : raw;
    }

    // Firestore Timestamp with toDate()
    if (typeof raw === "object" && typeof raw.toDate === "function") {
      const d = raw.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
    }

    // Firestore Timestamp {_seconds}
    if (typeof raw === "object" && typeof raw._seconds === "number") {
      const d = new Date(raw._seconds * 1000);
      return isNaN(d.getTime()) ? new Date() : d;
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

export function SessionCard({ session, userRole, onChat, onAction }: SessionCardProps) {
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);
  const [showFullDetails, setShowFullDetails] = useState(false);

  // Prefer scheduledDate; fallback to scheduledAt
  const scheduled = normalizeDate(session.scheduledDate ?? session.scheduledAt);

  const rawStatus: string = typeof session.status === "string" ? session.status : "scheduled";
  const status = rawStatus.replace("-", "_"); // "in-progress" -> "in_progress"

  const now = new Date();
  const isUpcoming = scheduled > now;
  const isToday = scheduled.toDateString() === now.toDateString();

  const otherUser = userRole === "student" ? session.tutor.user : session.student;
  const displayName =
    userRole === "student"
      ? `${session.tutor.user.firstName} ${session.tutor.user.lastName}`
      : `${session.student.firstName} ${session.student.lastName}`;

  const cancelRequestedByTutor = !!session.cancelRequestedByTutor;
  const cancelRequestedByStudent = !!session.cancelRequestedByStudent;

  const getStatusColor = (s: string) => {
    switch (s) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
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
  };

  // Prefer priceCents if present, fallback to price
  const priceValue =
    session.priceCents != null
      ? Number(session.priceCents) / 100
      : session.price != null
      ? Number(session.price)
      : undefined;

  const subjectName = session.subject?.name ?? "Session";

  const subjectIcon = (() => {
    const name = (subjectName || "").toLowerCase();
    if (name.includes("math")) return "fa-calculator";
    if (name.includes("science")) return "fa-flask";
    if (name.includes("english")) return "fa-book";
    if (name.includes("programming") || name.includes("computer")) return "fa-code";
    if (name.includes("history")) return "fa-landmark";
    if (name.includes("art")) return "fa-palette";
    return "fa-graduation-cap";
  })();

  // ---- Cancel button state logic ----
  const showRequestCancelButton =
    status === "scheduled" &&
    isUpcoming &&
    !cancelRequestedByTutor &&
    !cancelRequestedByStudent;

  const tutorShouldRespondToCancel =
    status === "scheduled" &&
    cancelRequestedByStudent &&
    userRole === "tutor";

  const studentShouldRespondToCancel =
    status === "scheduled" &&
    cancelRequestedByTutor &&
    userRole === "student";

  const waitingForOtherSide =
    status === "scheduled" &&
    ((cancelRequestedByTutor && userRole === "tutor") ||
      (cancelRequestedByStudent && userRole === "student"));

  return (
    <Card className="hover:shadow-md transition-shadow" data-testid={`session-card-${session.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 flex-1">
            {/* Subject Icon */}
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
              <i className={`fas ${subjectIcon} text-primary`} />
            </div>

            {/* Session Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2 mb-1 flex-wrap">
                <h3 className="font-semibold truncate" data-testid="text-session-title">
                  {userRole === "tutor" ? (
                    <>
                      <Badge variant="secondary" className="mr-2 bg-purple-100 text-purple-800">
                        {subjectName}
                      </Badge>
                      with {displayName}
                    </>
                  ) : (
                    `${subjectName} with ${displayName}`
                  )}
                </h3>
                <Badge className={getStatusColor(status)}>
                  {status.replace("_", " ")}
                </Badge>
              </div>

              <div className="flex items-center space-x-4 text-sm text-muted-foreground flex-wrap">
                <div className="flex items-center space-x-1">
                  <i className="fas fa-calendar text-xs" />
                  <span data-testid="text-session-date">
                    {format(scheduled, "MMM dd, yyyy")}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <i className="fas fa-clock text-xs" />
                  <span data-testid="text-session-time">
                    {format(scheduled, "HH:mm")}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <i className="fas fa-stopwatch text-xs" />
                  <span>{session.duration || 60} min</span>
                </div>
                {priceValue !== undefined && !Number.isNaN(priceValue) && (
                  <div className={`flex items-center space-x-1 ${userRole === "tutor" ? "font-semibold text-green-700" : ""}`}>
                    <i className="fas fa-coins text-xs" />
                    <span>{formatMoney(priceValue)}</span>
                  </div>
                )}

              </div>

              {/* Calendar-style time blocks display - Show for tutors always, for students only if multiple */}
              {session.timeSlots && session.timeSlots.length > 0 &&
               (userRole === "tutor" || session.timeSlots.length > 1) && (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">
                    <i className="fas fa-calendar-check text-xs mr-1" />
                    {session.timeSlots.length > 1 ? "Multiple Time Slots Booked:" : "Time Slot:"}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {session.timeSlots.map((slot: string, index: number) => {
                      // Calculate end time for each slot (assuming 60-minute slots)
                      const [hours, minutes] = slot.split(":").map(Number);
                      const endHours = hours + 1;
                      const endTime = `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

                      return (
                        <Badge
                          key={index}
                          variant="outline"
                          className="bg-primary/5 text-primary border-primary/20 text-xs font-medium"
                        >
                          {slot} - {endTime}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Session Notes - Show fully for tutors, truncate for students */}
              {session.notes && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                  <div className="text-xs font-semibold text-blue-900 mb-1">
                    <i className="fas fa-sticky-note text-xs mr-1" />
                    {userRole === "tutor" ? "Student's Focus Areas:" : "Your Notes:"}
                  </div>
                  <p className={`text-sm text-blue-800 ${userRole === "student" ? "truncate" : ""}`}>
                    {session.notes}
                  </p>
                </div>
              )}

              {/* Comprehensive Booking Details for Tutors (especially for pending sessions) */}
              {userRole === "tutor" && (status === "pending" || status === "scheduled") && (
                <div className="mt-3">
                  <button
                    onClick={() => setShowFullDetails(!showFullDetails)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <i className={`fas fa-chevron-${showFullDetails ? "up" : "down"} text-xs`} />
                    {showFullDetails ? "Hide" : "Show"} Full Booking Details
                  </button>

                  {showFullDetails && (
                    <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="font-semibold text-gray-700">Subject:</span>
                          <p className="text-gray-900">{subjectName}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-gray-700">Student:</span>
                          <p className="text-gray-900">{displayName}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-gray-700">Date:</span>
                          <p className="text-gray-900">{format(scheduled, "EEEE, MMM dd, yyyy")}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-gray-700">Duration:</span>
                          <p className="text-gray-900">{session.duration || 60} minutes</p>
                        </div>
                        {priceValue !== undefined && !Number.isNaN(priceValue) && (
                          <div>
                            <span className="font-semibold text-gray-700">Session Fee:</span>
                            <p className="text-gray-900 font-semibold">{formatMoney(priceValue)}</p>
                          </div>
                        )}
                      </div>

                      {session.timeSlots && session.timeSlots.length > 0 && (
                        <div>
                          <span className="font-semibold text-gray-700 text-xs">Time Slots:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {session.timeSlots.map((slot: string, index: number) => {
                              const [hours, minutes] = slot.split(":").map(Number);
                              const endHours = hours + 1;
                              const endTime = `${String(endHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
                              return (
                                <Badge key={index} variant="outline" className="text-xs">
                                  {slot} - {endTime}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {session.notes && (
                        <div>
                          <span className="font-semibold text-gray-700 text-xs">Student's Goals:</span>
                          <p className="text-xs text-gray-900 mt-1 p-2 bg-white rounded border">
                            {session.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Cancel request info / status */}
              {status === "scheduled" && (
                <div className="mt-3 text-xs">
                  {tutorShouldRespondToCancel && (
                    <div className="p-2 rounded bg-yellow-50 border border-yellow-200 text-yellow-900">
                      Student requested to cancel this session.
                    </div>
                  )}
                  {studentShouldRespondToCancel && (
                    <div className="p-2 rounded bg-yellow-50 border border-yellow-200 text-yellow-900">
                      Tutor requested to cancel this session.
                    </div>
                  )}
                  {waitingForOtherSide && (
                    <div className="p-2 rounded bg-blue-50 border border-blue-200 text-blue-900">
                      Waiting for the other person to confirm cancellation.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Other User Avatar */}
            <Avatar className="w-10 h-10 flex-shrink-0">
              <AvatarImage src={otherUser.profileImageUrl} alt={otherUser.firstName} />
              <AvatarFallback>
                {otherUser.firstName?.[0]}
                {otherUser.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Actions: Chat + Cancel Flow + AI Summary */}
          <div className="flex items-center space-x-2 ml-4">
            {/* Chat always available */}
            <Button
              variant="outline"
              size="sm"
              onClick={onChat}
              data-testid="button-chat"
            >
              <i className="fas fa-comment" />
            </Button>

            {/* Calendar download for scheduled and upcoming sessions */}
            {(status === "scheduled" || status === "in_progress") && isUpcoming && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open(`/api/sessions/${session.id}/calendar.ics`, "_blank");
                }}
                data-testid="button-add-to-calendar"
                title="Add to Calendar"
              >
                <i className="fas fa-calendar-plus" />
              </Button>
            )}

            {/* AI Summary button for tutors on completed sessions */}
            {userRole === "tutor" && status === "completed" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSummaryDialog(true)}
                data-testid="button-lesson-summary"
                className={session.aiSummary ? "border-blue-500 text-blue-600" : ""}
              >
                <i className={`fas ${session.aiSummary ? "fa-sparkles" : "fa-file-alt"} mr-1`} />
                {session.aiSummary ? "View Summary" : "Add Summary"}
              </Button>
            )}

            {/* View lesson report for students */}
            {userRole === "student" && status === "completed" && session.aiSummary && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSummaryDialog(true)}
                data-testid="button-view-report"
                className="border-blue-500 text-blue-600"
              >
                <i className="fas fa-file-alt mr-1" />
                View Report
              </Button>
            )}

            {/* Initial cancel request */}
            {showRequestCancelButton && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction?.("request_cancel")}
                data-testid="button-request-cancel"
              >
                <i className="fas fa-ban mr-1" />
                Cancel
              </Button>
            )}

            {/* Respond to cancel request */}
            {(tutorShouldRespondToCancel || studentShouldRespondToCancel) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAction?.("reject_cancel")}
                  data-testid="button-keep-session"
                >
                  Keep
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAction?.("accept_cancel")}
                  data-testid="button-accept-cancel"
                >
                  Confirm Cancel
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Today reminder */}
        {isToday && isUpcoming && status === "scheduled" && (
          <div className="mt-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-center space-x-2 text-sm text-yellow-800">
              <i className="fas fa-bell" />
              <span>
                Session starts today at {format(scheduled, "HH:mm")}
              </span>
            </div>
          </div>
        )}
      </CardContent>

      {/* Lesson Summary Dialog */}
      <LessonSummaryDialog
        session={session}
        open={showSummaryDialog}
        onOpenChange={setShowSummaryDialog}
        userRole={userRole}
      />
    </Card>
  );
}
