// server/email.ts
import { Resend } from "resend";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { fdb } from "./firebase-admin";

// -------------------------------
// Email service configuration
// -------------------------------
let emailService: "resend" | "smtp" | null = null;
let resendClient: Resend | null = null;
let smtpTransporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;

if (process.env.RESEND_API_KEY) {
  emailService = "resend";
  resendClient = new Resend(process.env.RESEND_API_KEY);
  console.log("Email service initialized with Resend");
} else if (
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
) {
  emailService = "smtp";
  const port = parseInt(process.env.SMTP_PORT, 10);
  const secure = port === 465; // 465 = SMTPS

  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log("Email service initialized with SMTP");
} else {
  console.warn("No email service configured. Set RESEND_API_KEY or SMTP credentials.");
}

export function getEmailServiceStatus(): {
  configured: boolean;
  service: "resend" | "smtp" | null;
  fromAddress: string | null;
} {
  if (emailService === "resend") {
    return {
      configured: true,
      service: "resend",
      fromAddress: process.env.RESEND_FROM || "Daresni <noreply@example.com>",
    };
  }

  if (emailService === "smtp") {
    return {
      configured: true,
      service: "smtp",
      fromAddress: process.env.SMTP_FROM || "Daresni <noreply@example.com>",
    };
  }

  return {
    configured: false,
    service: null,
    fromAddress: null,
  };
}

export interface EmailOptions {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

// -------------------------------
/** Send email using configured service (Resend or SMTP). */
export async function sendEmail(options: EmailOptions): Promise<void> {
  if (!emailService) {
    console.warn("Email service not configured, skipping email send");
    return;
  }

  try {
    if (emailService === "resend" && resendClient) {
      const fromEmail = process.env.RESEND_FROM || "Daresni <noreply@example.com>";
      // Resend supports attachments
      for (const to of options.to) {
        const emailData: any = {
          from: fromEmail,
          to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        };

        // Add attachments if present
        if (options.attachments && options.attachments.length > 0) {
          emailData.attachments = options.attachments.map(att => ({
            filename: att.filename,
            content: att.content,
          }));
        }

        await resendClient.emails.send(emailData);
      }
    } else if (emailService === "smtp" && smtpTransporter) {
      const fromEmail = process.env.SMTP_FROM || "Daresni <noreply@example.com>";
      const mailOptions: any = {
        from: fromEmail,
        to: options.to.join(", "),
        subject: options.subject,
        html: options.html,
        text: options.text,
      };

      // Add attachments if present
      if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments.map(att => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType || 'text/calendar',
        }));
      }

      await smtpTransporter.sendMail(mailOptions);
    }

    console.log(`Email sent successfully to ${options.to.length} recipient(s): ${options.subject}`);
  } catch (error) {
    console.error("Failed to send email:", error);
    throw error;
  }
}

// -------------------------------
/** Get all admin emails from Firestore `users` where role == 'admin'. */
export async function getAdminEmails(): Promise<string[]> {
  try {
    if (!fdb) {
      console.warn("Firebase Admin not initialized; cannot load admin emails.");
      return [];
    }
    const snap = await fdb.collection("users").where("role", "==", "admin").get();
    return snap.docs
      .map((d) => d.get("email") as string | undefined)
      .filter((e): e is string => !!e);
  } catch (error) {
    console.error("Failed to get admin emails:", error);
    return [];
  }
}

// -------------------------------
/** Convenience helper to send to all admins. */
export async function sendToAdmins(subject: string, html: string, text?: string): Promise<void> {
  const adminEmails = await getAdminEmails();

  if (adminEmails.length === 0) {
    console.warn("No admin emails found, skipping admin notification");
    return;
  }

  await sendEmail({
    to: adminEmails,
    subject,
    html,
    text,
  });
}

// -------------------------------
/** HTML/text template for tutor registration notification. */
export function createTutorRegistrationEmail(
  tutorName: string,
  tutorEmail: string
): { subject: string; html: string; text: string } {
  const subject = "New Tutor Registration - Daresni";
  const adminUrl = `${process.env.FRONTEND_URL || "http://localhost:5000"}/admin`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>New Tutor Registration</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #9B1B30; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .button {
          display: inline-block;
          background-color: #9B1B30;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 4px;
          margin: 10px 0;
        }
        .muted { color: #777; font-size: 12px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>New Tutor Registration</h1>
        </div>
        <div class="content">
          <h2>A new tutor has registered on Daresni!</h2>
          <p><strong>Tutor Name:</strong> ${tutorName}</p>
          <p><strong>Email:</strong> ${tutorEmail}</p>
          <p>Please review their profile and verify their credentials in the admin dashboard.</p>
          <a href="${adminUrl}" class="button">Review in Admin Dashboard</a>
          <p class="muted">This is an automated message; please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    "New Tutor Registration - Daresni",
    "",
    "A new tutor has registered on Daresni!",
    "",
    `Tutor Name: ${tutorName}`,
    `Email: ${tutorEmail}`,
    "",
    "Please review their profile and verify their credentials in the admin dashboard.",
    "",
    `Admin Dashboard: ${adminUrl}`,
  ].join("\n");

  return { subject, html, text };
}

// -------------------------------
/** Email templates for session reminders */

export function createSession24HourReminderEmail(
  recipientName: string,
  otherPartyName: string,
  otherPartyRole: "tutor" | "student",
  sessionDate: string,
  sessionTime: string,
  subject: string,
  meetingLink?: string | null
): { subject: string; html: string; text: string } {
  const emailSubject = `Reminder: Your tutoring session tomorrow at ${sessionTime}`;
  const dashboardUrl = `${process.env.FRONTEND_URL || "http://localhost:5000"}/dashboard`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Session Reminder</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #9B1B30; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .session-card { background-color: white; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #9B1B30; }
        .session-details { margin: 12px 0; }
        .session-details strong { color: #9B1B30; }
        .button {
          display: inline-block;
          background-color: #9B1B30;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 4px;
          margin: 10px 0;
        }
        .muted { color: #777; font-size: 12px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📚 Session Reminder</h1>
        </div>
        <div class="content">
          <h2>Hi ${recipientName}!</h2>
          <p>This is a friendly reminder about your upcoming tutoring session tomorrow.</p>

          <div class="session-card">
            <h3>Session Details</h3>
            <div class="session-details">
              <p><strong>Date:</strong> ${sessionDate}</p>
              <p><strong>Time:</strong> ${sessionTime}</p>
              <p><strong>${otherPartyRole === "tutor" ? "Tutor" : "Student"}:</strong> ${otherPartyName}</p>
              <p><strong>Subject:</strong> ${subject}</p>
              ${meetingLink ? `<p><strong>Meeting Link:</strong> <a href="${meetingLink}">${meetingLink}</a></p>` : ''}
            </div>
          </div>

          <p>Please make sure you're prepared and ready to attend!</p>

          <a href="${dashboardUrl}" class="button">View in Dashboard</a>

          <p class="muted">This is an automated reminder. Please contact support if you need to reschedule.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    `Session Reminder - ${emailSubject}`,
    "",
    `Hi ${recipientName}!`,
    "",
    "This is a friendly reminder about your upcoming tutoring session tomorrow.",
    "",
    "Session Details:",
    `Date: ${sessionDate}`,
    `Time: ${sessionTime}`,
    `${otherPartyRole === "tutor" ? "Tutor" : "Student"}: ${otherPartyName}`,
    `Subject: ${subject}`,
    meetingLink ? `Meeting Link: ${meetingLink}` : "",
    "",
    "Please make sure you're prepared and ready to attend!",
    "",
    `Dashboard: ${dashboardUrl}`,
  ].filter(Boolean).join("\n");

  return { subject: emailSubject, html, text };
}

export function createSession1HourReminderEmail(
  recipientName: string,
  otherPartyName: string,
  otherPartyRole: "tutor" | "student",
  sessionTime: string,
  subject: string,
  meetingLink?: string | null
): { subject: string; html: string; text: string } {
  const emailSubject = `Starting Soon: Your session in 1 hour at ${sessionTime}`;
  const dashboardUrl = `${process.env.FRONTEND_URL || "http://localhost:5000"}/dashboard`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Session Starting Soon</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #f59e0b; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .urgency-box { background-color: #fef3c7; border: 2px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center; }
        .button {
          display: inline-block;
          background-color: #f59e0b;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 4px;
          margin: 10px 0;
          font-weight: bold;
        }
        .muted { color: #777; font-size: 12px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⏰ Session Starting Soon!</h1>
        </div>
        <div class="content">
          <h2>Hi ${recipientName}!</h2>

          <div class="urgency-box">
            <h3 style="margin: 0 0 8px 0;">Your tutoring session starts in 1 hour</h3>
            <p style="margin: 0;"><strong>Time:</strong> ${sessionTime}</p>
            <p style="margin: 0;"><strong>${otherPartyRole === "tutor" ? "Tutor" : "Student"}:</strong> ${otherPartyName}</p>
            <p style="margin: 0;"><strong>Subject:</strong> ${subject}</p>
          </div>

          <p style="text-align: center; font-size: 18px; margin: 20px 0;">Get ready to learn! 📚</p>

          ${meetingLink ? `<div style="text-align: center;"><a href="${meetingLink}" class="button">Join Meeting</a></div>` : `<div style="text-align: center;"><a href="${dashboardUrl}" class="button">Go to Dashboard</a></div>`}

          <p class="muted">This is an automated reminder.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    `⏰ ${emailSubject}`,
    "",
    `Hi ${recipientName}!`,
    "",
    "Your tutoring session starts in 1 hour!",
    "",
    `Time: ${sessionTime}`,
    `${otherPartyRole === "tutor" ? "Tutor" : "Student"}: ${otherPartyName}`,
    `Subject: ${subject}`,
    "",
    meetingLink ? `Join Meeting: ${meetingLink}` : `Dashboard: ${dashboardUrl}`,
  ].join("\n");

  return { subject: emailSubject, html, text };
}

export function createSession15MinReminderEmail(
  recipientName: string,
  otherPartyName: string,
  sessionTime: string,
  meetingLink?: string | null
): { subject: string; html: string; text: string } {
  const emailSubject = `🚨 Session starting NOW in 15 minutes!`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Session Starting NOW</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #ef4444; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; text-align: center; }
        .urgent { font-size: 24px; font-weight: bold; color: #ef4444; margin: 20px 0; }
        .button {
          display: inline-block;
          background-color: #ef4444;
          color: white;
          padding: 16px 32px;
          text-decoration: none;
          border-radius: 8px;
          margin: 20px 0;
          font-weight: bold;
          font-size: 18px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚨 SESSION STARTING NOW!</h1>
        </div>
        <div class="content">
          <p class="urgent">Hi ${recipientName}!</p>
          <h2>Your session with ${otherPartyName} is starting in 15 minutes at ${sessionTime}</h2>

          ${meetingLink ? `
            <a href="${meetingLink}" class="button">🎥 JOIN NOW</a>
            <p style="margin-top: 20px; font-size: 14px;">Click the button above to join your session immediately</p>
          ` : `
            <p style="font-size: 18px; margin: 20px 0;">Please be ready to start!</p>
          `}
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    `🚨 ${emailSubject}`,
    "",
    `Hi ${recipientName}!`,
    "",
    `Your session with ${otherPartyName} is starting in 15 minutes at ${sessionTime}`,
    "",
    meetingLink ? `JOIN NOW: ${meetingLink}` : "Please be ready to start!",
  ].join("\n");

  return { subject: emailSubject, html, text };
}

export function createSessionCancellationEmail(
  recipientName: string,
  sessionDate: string,
  sessionTime: string,
  subject: string,
  reason: string
): { subject: string; html: string; text: string } {
  const emailSubject = `Session Cancelled: ${subject} on ${sessionDate}`;
  const dashboardUrl = `${process.env.FRONTEND_URL || "http://localhost:5000"}/dashboard`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Session Cancelled</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #6b7280; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .cancel-box { background-color: #fee2e2; border: 2px solid #ef4444; padding: 16px; border-radius: 8px; margin: 16px 0; }
        .button {
          display: inline-block;
          background-color: #9B1B30;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 4px;
          margin: 10px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Session Cancelled</h1>
        </div>
        <div class="content">
          <h2>Hi ${recipientName},</h2>

          <div class="cancel-box">
            <h3>Your tutoring session has been cancelled</h3>
            <p><strong>Date:</strong> ${sessionDate}</p>
            <p><strong>Time:</strong> ${sessionTime}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Reason:</strong> ${reason}</p>
          </div>

          <p>If this was cancelled in error or if you need to reschedule, please book a new session through your dashboard.</p>

          <a href="${dashboardUrl}" class="button">Go to Dashboard</a>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    `Session Cancelled - ${emailSubject}`,
    "",
    `Hi ${recipientName},`,
    "",
    "Your tutoring session has been cancelled:",
    "",
    `Date: ${sessionDate}`,
    `Time: ${sessionTime}`,
    `Subject: ${subject}`,
    `Reason: ${reason}`,
    "",
    "If this was cancelled in error or if you need to reschedule, please book a new session through your dashboard.",
    "",
    `Dashboard: ${dashboardUrl}`,
  ].join("\n");

  return { subject: emailSubject, html, text };
}
