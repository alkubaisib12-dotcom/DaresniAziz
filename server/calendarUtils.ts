// server/calendarUtils.ts
/**
 * Generate iCalendar (.ics) file content for a tutoring session
 * Compatible with Google Calendar, Apple Calendar, Outlook, etc.
 */

export interface CalendarEventData {
  sessionId: string;
  title: string;
  description: string;
  location: string;
  startTime: Date;
  endTime: Date;
  attendees?: Array<{ name: string; email: string }>;
  meetingLink?: string | null;
}

/**
 * Generate .ics file content for a session
 */
export function generateICS(event: CalendarEventData): string {
  const now = new Date();
  const timestamp = formatICSDate(now);

  // Format dates for iCal (YYYYMMDDTHHMMSSZ in UTC)
  const dtstart = formatICSDate(event.startTime);
  const dtend = formatICSDate(event.endTime);

  // Generate a unique ID for the event
  const uid = `session-${event.sessionId}@daresni.com`;

  // Escape special characters in text fields
  const escapeText = (text: string): string => {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  };

  const title = escapeText(event.title);
  const description = escapeText(
    event.meetingLink
      ? `${event.description}\\n\\nJoin Meeting: ${event.meetingLink}`
      : event.description
  );
  const location = escapeText(event.location);

  // Build attendees list
  let attendeesStr = "";
  if (event.attendees && event.attendees.length > 0) {
    attendeesStr = event.attendees
      .map((attendee) => {
        const name = escapeText(attendee.name);
        return `ATTENDEE;CN=${name};ROLE=REQ-PARTICIPANT:mailto:${attendee.email}`;
      })
      .join("\r\n");
  }

  // Build the iCal content
  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Daresni//Tutoring Platform//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${timestamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    attendeesStr,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "DESCRIPTION:Session starting in 15 minutes",
    "ACTION:DISPLAY",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  return icsContent;
}

/**
 * Format date for iCalendar format (YYYYMMDDTHHMMSSZ)
 */
function formatICSDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Generate Google Calendar add event URL
 */
export function generateGoogleCalendarURL(event: CalendarEventData): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    details: event.meetingLink
      ? `${event.description}\n\nJoin Meeting: ${event.meetingLink}`
      : event.description,
    location: event.location,
    dates: `${formatGoogleDate(event.startTime)}/${formatGoogleDate(event.endTime)}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Format date for Google Calendar (YYYYMMDDTHHMMSSZ)
 */
function formatGoogleDate(date: Date): string {
  return formatICSDate(date);
}

/**
 * Generate session calendar event data from session document
 */
export function createCalendarEventFromSession(
  session: any,
  studentName: string,
  tutorName: string,
  subjectName: string,
  studentEmail?: string,
  tutorEmail?: string
): CalendarEventData {
  const startTime = toDate(session.scheduledAt) || new Date();
  const endTime = new Date(startTime.getTime() + (session.duration || 60) * 60 * 1000);

  const attendees = [];
  if (studentEmail) {
    attendees.push({ name: studentName, email: studentEmail });
  }
  if (tutorEmail) {
    attendees.push({ name: tutorName, email: tutorEmail });
  }

  return {
    sessionId: session.id,
    title: `Tutoring Session: ${subjectName}`,
    description: `Tutoring session with ${tutorName} for ${subjectName}`,
    location: session.meetingLink || "Daresni Platform",
    startTime,
    endTime,
    attendees,
    meetingLink: session.meetingLink,
  };
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
