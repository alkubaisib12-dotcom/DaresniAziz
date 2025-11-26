// server/sessionReminders.ts
import { fdb } from "./firebase-admin";
import {
  sendEmail,
  createSession24HourReminderEmail,
  createSession1HourReminderEmail,
  createSession15MinReminderEmail,
  createSessionCancellationEmail,
} from "./email";

export interface ReminderStatus {
  reminder24h: boolean;
  reminder1h: boolean;
  reminder15min: boolean;
  lastChecked?: Date;
}

/**
 * Check and send session reminders
 * This function should be called by a cron job every 5-10 minutes
 */
export async function processSessionReminders(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  if (!fdb) {
    console.warn("Firebase not initialized, skipping reminder processing");
    return { processed: 0, sent: 0, errors: 0 };
  }

  let processed = 0;
  let sent = 0;
  let errors = 0;

  try {
    const now = new Date();

    // Get all scheduled sessions in the next 25 hours
    const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const sessionsSnap = await fdb
      .collection("tutoring_sessions")
      .where("status", "==", "scheduled")
      .get();

    const sessions = sessionsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filter sessions within our time window
    const upcomingSessions = sessions.filter((session: any) => {
      const scheduledAt = toDate(session.scheduledAt);
      if (!scheduledAt) return false;
      return scheduledAt > now && scheduledAt <= in25Hours;
    });

    console.log(`Found ${upcomingSessions.length} upcoming sessions to check for reminders`);

    for (const session of upcomingSessions) {
      processed++;

      try {
        const scheduledAt = toDate(session.scheduledAt);
        if (!scheduledAt) continue;

        const hoursUntilSession = (scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60);
        const minutesUntilSession = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);

        const reminderStatus: ReminderStatus = session.reminderStatus || {
          reminder24h: false,
          reminder1h: false,
          reminder15min: false,
        };

        let shouldUpdate = false;
        let emailsSent = 0;

        // 24 hour reminder (send between 24h and 23h before session)
        if (!reminderStatus.reminder24h && hoursUntilSession <= 24 && hoursUntilSession > 23) {
          const success = await sendSessionReminder(session, "24h");
          if (success) {
            reminderStatus.reminder24h = true;
            shouldUpdate = true;
            emailsSent++;
          }
        }

        // 1 hour reminder (send between 1h and 50min before session)
        if (!reminderStatus.reminder1h && minutesUntilSession <= 60 && minutesUntilSession > 50) {
          const success = await sendSessionReminder(session, "1h");
          if (success) {
            reminderStatus.reminder1h = true;
            shouldUpdate = true;
            emailsSent++;
          }
        }

        // 15 minute reminder (send between 15min and 10min before session)
        if (!reminderStatus.reminder15min && minutesUntilSession <= 15 && minutesUntilSession > 10) {
          const success = await sendSessionReminder(session, "15min");
          if (success) {
            reminderStatus.reminder15min = true;
            shouldUpdate = true;
            emailsSent++;
          }
        }

        // Update reminder status in Firestore
        if (shouldUpdate) {
          await fdb
            .collection("tutoring_sessions")
            .doc(session.id)
            .update({
              reminderStatus,
              "reminderStatus.lastChecked": new Date(),
            });

          sent += emailsSent;
          console.log(`Sent ${emailsSent} reminder(s) for session ${session.id}`);
        }
      } catch (error) {
        console.error(`Error processing reminders for session ${session.id}:`, error);
        errors++;
      }
    }

    console.log(`Reminder processing complete: ${processed} processed, ${sent} sent, ${errors} errors`);
    return { processed, sent, errors };
  } catch (error) {
    console.error("Error in processSessionReminders:", error);
    return { processed, sent, errors };
  }
}

/**
 * Send a specific reminder for a session
 */
async function sendSessionReminder(
  session: any,
  type: "24h" | "1h" | "15min"
): Promise<boolean> {
  try {
    // Fetch user details
    const [studentSnap, tutorProfileSnap, subjectSnap] = await Promise.all([
      fdb!.collection("users").doc(session.studentId).get(),
      fdb!.collection("tutor_profiles").doc(session.tutorId).get(),
      fdb!.collection("subjects").doc(session.subjectId).get(),
    ]);

    if (!studentSnap.exists || !tutorProfileSnap.exists || !subjectSnap.exists) {
      console.warn(`Missing data for session ${session.id}`);
      return false;
    }

    const student = studentSnap.data();
    const tutorProfile = tutorProfileSnap.data();
    const subject = subjectSnap.data();

    // Get tutor user details
    const tutorUserSnap = await fdb!.collection("users").doc(tutorProfile?.userId).get();
    const tutorUser = tutorUserSnap.exists ? tutorUserSnap.data() : null;

    if (!student || !tutorUser || !subject) {
      console.warn(`Missing user/subject data for session ${session.id}`);
      return false;
    }

    const scheduledAt = toDate(session.scheduledAt);
    if (!scheduledAt) return false;

    const sessionDate = scheduledAt.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const sessionTime = scheduledAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const studentName = `${student.firstName || ""} ${student.lastName || ""}`.trim() || "Student";
    const tutorName = `${tutorUser.firstName || ""} ${tutorUser.lastName || ""}`.trim() || "Tutor";

    // Prepare emails for both student and tutor
    const emails: Array<{ to: string; template: { subject: string; html: string; text: string } }> = [];

    if (type === "24h") {
      // Send to student
      if (student.email) {
        emails.push({
          to: student.email,
          template: createSession24HourReminderEmail(
            studentName,
            tutorName,
            "tutor",
            sessionDate,
            sessionTime,
            subject.name,
            session.meetingLink
          ),
        });
      }

      // Send to tutor
      if (tutorUser.email) {
        emails.push({
          to: tutorUser.email,
          template: createSession24HourReminderEmail(
            tutorName,
            studentName,
            "student",
            sessionDate,
            sessionTime,
            subject.name,
            session.meetingLink
          ),
        });
      }
    } else if (type === "1h") {
      // Send to student
      if (student.email) {
        emails.push({
          to: student.email,
          template: createSession1HourReminderEmail(
            studentName,
            tutorName,
            "tutor",
            sessionTime,
            subject.name,
            session.meetingLink
          ),
        });
      }

      // Send to tutor
      if (tutorUser.email) {
        emails.push({
          to: tutorUser.email,
          template: createSession1HourReminderEmail(
            tutorName,
            studentName,
            "student",
            sessionTime,
            subject.name,
            session.meetingLink
          ),
        });
      }
    } else if (type === "15min") {
      // Send to student
      if (student.email) {
        emails.push({
          to: student.email,
          template: createSession15MinReminderEmail(
            studentName,
            tutorName,
            sessionTime,
            session.meetingLink
          ),
        });
      }

      // Send to tutor
      if (tutorUser.email) {
        emails.push({
          to: tutorUser.email,
          template: createSession15MinReminderEmail(
            tutorName,
            studentName,
            sessionTime,
            session.meetingLink
          ),
        });
      }
    }

    // Send all emails
    for (const email of emails) {
      try {
        await sendEmail({
          to: [email.to],
          subject: email.template.subject,
          html: email.template.html,
          text: email.template.text,
        });
      } catch (error) {
        console.error(`Failed to send ${type} reminder to ${email.to}:`, error);
      }
    }

    return true;
  } catch (error) {
    console.error(`Error sending ${type} reminder for session ${session.id}:`, error);
    return false;
  }
}

/**
 * Helper to convert Firestore Timestamp to Date
 */
function toDate(value: any): Date | null {
  try {
    if (!value) return null;
    if (value instanceof Date) return value;
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

/**
 * Auto-cancel sessions that weren't confirmed 2 hours before
 * (Optional feature - can be enabled later)
 */
export async function cancelUnconfirmedSessions(): Promise<number> {
  if (!fdb) {
    console.warn("Firebase not initialized, skipping cancellation check");
    return 0;
  }

  let cancelledCount = 0;

  try {
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const sessionsSnap = await fdb
      .collection("tutoring_sessions")
      .where("status", "==", "scheduled")
      .get();

    const sessions = sessionsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    for (const session of sessions) {
      const scheduledAt = toDate(session.scheduledAt);
      if (!scheduledAt) continue;

      // Check if session is within 2 hours and not confirmed by student
      if (scheduledAt <= twoHoursFromNow && !session.studentConfirmed) {
        // Cancel the session
        await fdb
          .collection("tutoring_sessions")
          .doc(session.id)
          .update({
            status: "cancelled",
            cancellationReason: "Not confirmed by student 2 hours before session",
            cancelledAt: new Date(),
          });

        // Send cancellation emails
        await sendCancellationEmail(session, "Not confirmed by student 2 hours before session");

        cancelledCount++;
        console.log(`Auto-cancelled unconfirmed session ${session.id}`);
      }
    }

    console.log(`Auto-cancelled ${cancelledCount} unconfirmed sessions`);
    return cancelledCount;
  } catch (error) {
    console.error("Error cancelling unconfirmed sessions:", error);
    return cancelledCount;
  }
}

/**
 * Send cancellation email to both parties
 */
async function sendCancellationEmail(session: any, reason: string): Promise<void> {
  try {
    const [studentSnap, tutorProfileSnap, subjectSnap] = await Promise.all([
      fdb!.collection("users").doc(session.studentId).get(),
      fdb!.collection("tutor_profiles").doc(session.tutorId).get(),
      fdb!.collection("subjects").doc(session.subjectId).get(),
    ]);

    if (!studentSnap.exists || !tutorProfileSnap.exists || !subjectSnap.exists) return;

    const student = studentSnap.data();
    const tutorProfile = tutorProfileSnap.data();
    const subject = subjectSnap.data();

    const tutorUserSnap = await fdb!.collection("users").doc(tutorProfile?.userId).get();
    const tutorUser = tutorUserSnap.exists ? tutorUserSnap.data() : null;

    if (!student || !tutorUser || !subject) return;

    const scheduledAt = toDate(session.scheduledAt);
    if (!scheduledAt) return;

    const sessionDate = scheduledAt.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const sessionTime = scheduledAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const studentName = `${student.firstName || ""} ${student.lastName || ""}`.trim() || "Student";
    const tutorName = `${tutorUser.firstName || ""} ${tutorUser.lastName || ""}`.trim() || "Tutor";

    // Send to student
    if (student.email) {
      const { subject: emailSubject, html, text } = createSessionCancellationEmail(
        studentName,
        sessionDate,
        sessionTime,
        subject.name,
        reason
      );

      await sendEmail({
        to: [student.email],
        subject: emailSubject,
        html,
        text,
      });
    }

    // Send to tutor
    if (tutorUser.email) {
      const { subject: emailSubject, html, text } = createSessionCancellationEmail(
        tutorName,
        sessionDate,
        sessionTime,
        subject.name,
        reason
      );

      await sendEmail({
        to: [tutorUser.email],
        subject: emailSubject,
        html,
        text,
      });
    }
  } catch (error) {
    console.error("Error sending cancellation emails:", error);
  }
}
