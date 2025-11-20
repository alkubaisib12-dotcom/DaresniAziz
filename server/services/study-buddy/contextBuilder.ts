/**
 * Student Context Builder
 *
 * Aggregates all relevant student data to provide personalized AI responses.
 * This is what makes Study Buddy better than generic ChatGPT.
 */

import { db } from "../../firebase-admin";
import {
  StudentContext,
  ContextBuilderOptions,
  DEFAULT_VALUES,
} from "../../../shared/studyBuddyTypes";
import { Timestamp } from "firebase-admin/firestore";
import { calculateMasteryScore } from "./adaptiveDifficulty";

/**
 * Build complete student context for AI personalization
 */
export async function buildStudentContext(
  userId: string,
  options: ContextBuilderOptions = {}
): Promise<StudentContext> {
  const {
    includeRecentSessions = true,
    includeQuizHistory = true,
    includeProgressData = true,
    sessionsLimit = DEFAULT_VALUES.CONTEXT_SESSIONS_LIMIT,
    quizzesLimit = DEFAULT_VALUES.CONTEXT_QUIZZES_LIMIT,
  } = options;

  // Fetch user profile
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  // Build context object
  const context: StudentContext = {
    userId,
    firstName: userData?.firstName,
    enrolledSubjects: [],
    progressBySubject: [],
    studyStreak: 0,
    totalStudyTimHours: 0,
  };

  // Fetch enrolled subjects from user's sessions
  if (includeRecentSessions || includeProgressData) {
    context.enrolledSubjects = await getEnrolledSubjects(userId);
  }

  // Fetch progress data
  if (includeProgressData) {
    context.progressBySubject = await getProgressBySubject(userId);
  }

  // Fetch recent tutoring sessions
  if (includeRecentSessions) {
    context.recentSessions = await getRecentSessions(userId, sessionsLimit);
  }

  // Fetch recent quiz history
  if (includeQuizHistory) {
    context.recentQuizzes = await getRecentQuizzes(userId, quizzesLimit);
  }

  // Calculate study streak
  context.studyStreak = await calculateStudyStreak(userId);

  // Calculate total study time (estimate from quizzes and sessions)
  context.totalStudyTimHours = await calculateTotalStudyTime(userId);

  return context;
}

/**
 * Get subjects the student is enrolled in (based on tutoring sessions)
 */
async function getEnrolledSubjects(
  userId: string
): Promise<StudentContext["enrolledSubjects"]> {
  try {
    // Get unique subject IDs from student's sessions
    const sessionsSnapshot = await db
      .collection("tutoring_sessions")
      .where("studentId", "==", userId)
      .orderBy("scheduledAt", "desc")
      .limit(50)
      .get();

    const subjectIds = new Set<string>();
    sessionsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.subjectId) {
        subjectIds.add(data.subjectId);
      }
    });

    // Fetch subject details
    const subjects: StudentContext["enrolledSubjects"] = [];
    for (const subjectId of subjectIds) {
      const subjectDoc = await db.collection("subjects").doc(subjectId).get();
      if (subjectDoc.exists) {
        const subjectData = subjectDoc.data();
        subjects.push({
          subjectId,
          subjectName: subjectData?.name || "Unknown Subject",
          description: subjectData?.description,
        });
      }
    }

    return subjects;
  } catch (error: any) {
    // Handle missing index error gracefully
    if (error?.code === 9) {
      console.warn(
        "Firebase index missing for tutoring_sessions query. Returning empty subjects list."
      );
      return [];
    }
    throw error;
  }
}

/**
 * Get progress data organized by subject
 */
async function getProgressBySubject(
  userId: string
): Promise<StudentContext["progressBySubject"]> {
  const progressSnapshot = await db
    .collection("study_buddy_progress")
    .where("userId", "==", userId)
    .get();

  const progressBySubject: StudentContext["progressBySubject"] = [];

  for (const doc of progressSnapshot.docs) {
    const progress = doc.data();
    const masteryScore = calculateMasteryScore(progress as any);

    // Fetch subject name
    let subjectName = "Unknown Subject";
    if (progress.subjectId) {
      const subjectDoc = await db
        .collection("subjects")
        .doc(progress.subjectId)
        .get();
      if (subjectDoc.exists) {
        subjectName = subjectDoc.data()?.name || subjectName;
      }
    }

    progressBySubject.push({
      subjectId: progress.subjectId,
      subjectName,
      masteryScore,
      weakAreas: progress.weakAreas || [],
      strengths: progress.strengths || [],
      lastPracticed: progress.lastPracticed?.toDate?.()?.toISOString() || "",
    });
  }

  // Sort by mastery score (lowest first - prioritize weak subjects)
  progressBySubject.sort((a, b) => a.masteryScore - b.masteryScore);

  return progressBySubject;
}

/**
 * Get recent tutoring sessions with notes and summaries
 */
async function getRecentSessions(
  userId: string,
  limit: number
): Promise<StudentContext["recentSessions"]> {
  try {
    const sessionsSnapshot = await db
      .collection("tutoring_sessions")
      .where("studentId", "==", userId)
      .where("status", "==", "completed")
      .orderBy("scheduledAt", "desc")
      .limit(limit)
      .get();

    const sessions: NonNullable<StudentContext["recentSessions"]> = [];

    for (const doc of sessionsSnapshot.docs) {
      const session = doc.data();

      // Fetch subject name
      let subjectName = "Unknown Subject";
      if (session.subjectId) {
        const subjectDoc = await db
          .collection("subjects")
          .doc(session.subjectId)
          .get();
        if (subjectDoc.exists) {
          subjectName = subjectDoc.data()?.name || subjectName;
        }
      }

      // Fetch tutor name
      let tutorName = "Unknown Tutor";
      if (session.tutorId) {
        const tutorDoc = await db.collection("users").doc(session.tutorId).get();
        if (tutorDoc.exists) {
          const tutorData = tutorDoc.data();
          tutorName = `${tutorData?.firstName || ""} ${tutorData?.lastName || ""}`.trim();
        }
      }

      sessions.push({
        sessionId: doc.id,
        subjectName,
        tutorName,
        date: session.scheduledAt?.toDate?.()?.toISOString() || "",
        notes: session.tutorNotes,
        aiSummary: session.aiSummary,
      });
    }

    return sessions;
  } catch (error: any) {
    // Handle missing index error gracefully
    if (error?.code === 9) {
      console.warn(
        "Firebase index missing for tutoring_sessions query. Returning empty sessions list."
      );
      return [];
    }
    throw error;
  }
}

/**
 * Get recent quiz attempts
 */
async function getRecentQuizzes(
  userId: string,
  limit: number
): Promise<StudentContext["recentQuizzes"]> {
  const attemptsSnapshot = await db
    .collection("study_buddy_quiz_attempts")
    .where("userId", "==", userId)
    .orderBy("startedAt", "desc")
    .limit(limit)
    .get();

  const quizzes: NonNullable<StudentContext["recentQuizzes"]> = [];

  for (const doc of attemptsSnapshot.docs) {
    const attempt = doc.data();

    // Fetch quiz details
    if (attempt.quizId) {
      const quizDoc = await db
        .collection("study_buddy_quizzes")
        .doc(attempt.quizId)
        .get();

      if (quizDoc.exists) {
        const quiz = quizDoc.data();

        quizzes.push({
          quizId: attempt.quizId,
          topic: quiz?.topic || "Unknown Topic",
          difficulty: attempt.difficultyProgression?.[0]?.difficulty || "medium",
          score: attempt.score,
          date: attempt.startedAt?.toDate?.()?.toISOString() || "",
        });
      }
    }
  }

  return quizzes;
}

/**
 * Calculate study streak (consecutive days with activity)
 */
async function calculateStudyStreak(userId: string): Promise<number> {
  // Get all study buddy activities sorted by date
  const messagesSnapshot = await db
    .collection("study_buddy_messages")
    .where("userId", "==", userId)
    .orderBy("timestamp", "desc")
    .limit(100)
    .get();

  if (messagesSnapshot.empty) return 0;

  // Extract unique dates
  const activityDates = new Set<string>();
  messagesSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.timestamp) {
      const date = data.timestamp.toDate();
      const dateString = date.toISOString().split("T")[0]; // YYYY-MM-DD
      activityDates.add(dateString);
    }
  });

  // Count consecutive days from today
  const today = new Date();
  let streak = 0;
  let checkDate = new Date(today);

  while (true) {
    const dateString = checkDate.toISOString().split("T")[0];

    if (activityDates.has(dateString)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1); // Go back one day
    } else {
      // Allow one day gap (streak continues if yesterday had activity)
      if (streak === 0 && checkDate.toDateString() === today.toDateString()) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }

    // Safety limit
    if (streak > 365) break;
  }

  return streak;
}

/**
 * Estimate total study time from quiz attempts and sessions
 */
async function calculateTotalStudyTime(userId: string): Promise<number> {
  let totalMinutes = 0;

  try {
    // Count time from quiz attempts
    const quizAttemptsSnapshot = await db
      .collection("study_buddy_quiz_attempts")
      .where("userId", "==", userId)
      .get();

    quizAttemptsSnapshot.docs.forEach((doc) => {
      const attempt = doc.data();
      if (attempt.answers) {
        const quizTime = attempt.answers.reduce(
          (sum: number, ans: any) => sum + (ans.timeSpentSeconds || 0),
          0
        );
        totalMinutes += quizTime / 60;
      }
    });
  } catch (error: any) {
    console.warn("Error fetching quiz attempts for study time:", error);
  }

  try {
    // Count time from completed sessions
    const sessionsSnapshot = await db
      .collection("tutoring_sessions")
      .where("studentId", "==", userId)
      .where("status", "==", "completed")
      .get();

    sessionsSnapshot.docs.forEach((doc) => {
      const session = doc.data();
      totalMinutes += session.duration || 60; // Default to 60 min if not specified
    });
  } catch (error: any) {
    // Handle missing index error gracefully
    if (error?.code === 9) {
      console.warn(
        "Firebase index missing for tutoring_sessions query. Skipping session time calculation."
      );
    } else {
      console.warn("Error fetching sessions for study time:", error);
    }
  }

  try {
    // Estimate time from conversation messages (rough estimate)
    const messagesSnapshot = await db
      .collection("study_buddy_messages")
      .where("userId", "==", userId)
      .where("role", "==", "user")
      .get();

    // Assume ~2 minutes per user message (reading + thinking + typing)
    totalMinutes += messagesSnapshot.size * 2;
  } catch (error: any) {
    console.warn("Error fetching messages for study time:", error);
  }

  return Math.round(totalMinutes / 60); // Convert to hours
}

/**
 * Build a concise text summary of student context for AI prompts
 */
export function formatContextForAI(context: StudentContext): string {
  let summary = `**Student Profile:**\n`;
  summary += `- Name: ${context.firstName || "Student"}\n`;
  summary += `- Study Streak: ${context.studyStreak} days\n`;
  summary += `- Total Study Time: ${context.totalStudyTimHours} hours\n\n`;

  // Enrolled subjects
  if (context.enrolledSubjects.length > 0) {
    summary += `**Enrolled Subjects:**\n`;
    context.enrolledSubjects.forEach((subject) => {
      summary += `- ${subject.subjectName}\n`;
    });
    summary += `\n`;
  }

  // Progress by subject
  if (context.progressBySubject.length > 0) {
    summary += `**Performance by Subject:**\n`;
    context.progressBySubject.slice(0, 5).forEach((progress) => {
      summary += `- ${progress.subjectName}: ${progress.masteryScore}% mastery\n`;
      if (progress.weakAreas.length > 0) {
        summary += `  Weak areas: ${progress.weakAreas.slice(0, 3).join(", ")}\n`;
      }
      if (progress.strengths.length > 0) {
        summary += `  Strengths: ${progress.strengths.slice(0, 2).join(", ")}\n`;
      }
    });
    summary += `\n`;
  }

  // Recent quizzes
  if (context.recentQuizzes && context.recentQuizzes.length > 0) {
    summary += `**Recent Quiz Performance:**\n`;
    context.recentQuizzes.slice(0, 3).forEach((quiz) => {
      summary += `- ${quiz.topic}: ${quiz.score}% (${quiz.difficulty})\n`;
    });
    summary += `\n`;
  }

  // Recent sessions
  if (context.recentSessions && context.recentSessions.length > 0) {
    summary += `**Recent Tutoring Sessions:**\n`;
    context.recentSessions.slice(0, 3).forEach((session) => {
      summary += `- ${session.subjectName} with ${session.tutorName}\n`;
      if (session.aiSummary?.whatWasLearned) {
        summary += `  Learned: ${session.aiSummary.whatWasLearned.substring(0, 100)}...\n`;
      }
    });
    summary += `\n`;
  }

  return summary;
}

/**
 * Get quick context summary for lightweight operations
 */
export async function getQuickContext(
  userId: string
): Promise<Pick<StudentContext, "userId" | "firstName" | "enrolledSubjects">> {
  const userDoc = await db.collection("users").doc(userId).get();
  const userData = userDoc.data();

  const enrolledSubjects = await getEnrolledSubjects(userId);

  return {
    userId,
    firstName: userData?.firstName,
    enrolledSubjects,
  };
}
