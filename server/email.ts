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
      // Resend supports single or multiple recipients; sending one-by-one is fine:
      for (const to of options.to) {
        await resendClient.emails.send({
          from: fromEmail,
          to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        });
      }
    } else if (emailService === "smtp" && smtpTransporter) {
      const fromEmail = process.env.SMTP_FROM || "Daresni <noreply@example.com>";
      await smtpTransporter.sendMail({
        from: fromEmail,
        to: options.to.join(", "),
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
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
