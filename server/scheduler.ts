// server/scheduler.ts
import { processSessionReminders } from "./sessionReminders";

let reminderInterval: NodeJS.Timeout | null = null;

/**
 * Start the reminder scheduler
 * Runs every 10 minutes to check for sessions that need reminders
 */
export function startReminderScheduler(): void {
  // Don't start multiple instances
  if (reminderInterval) {
    console.log("Reminder scheduler already running");
    return;
  }

  console.log("Starting session reminder scheduler...");

  // Run immediately on startup
  processSessionReminders().catch((error) => {
    console.error("Error in initial reminder processing:", error);
  });

  // Then run every 10 minutes
  const TEN_MINUTES = 10 * 60 * 1000;
  reminderInterval = setInterval(async () => {
    try {
      console.log("Running scheduled reminder check...");
      const result = await processSessionReminders();
      console.log(
        `Reminder check complete: ${result.processed} processed, ${result.sent} sent, ${result.errors} errors, ${result.autoCompleted} auto-completed`
      );
    } catch (error) {
      console.error("Error in scheduled reminder processing:", error);
    }
  }, TEN_MINUTES);

  console.log("Reminder scheduler started successfully (runs every 10 minutes)");
}

/**
 * Stop the reminder scheduler
 */
export function stopReminderScheduler(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    console.log("Reminder scheduler stopped");
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return reminderInterval !== null;
}
