/**
 * Adaptive Difficulty Algorithm
 *
 * This service implements the core adaptive learning algorithm that:
 * 1. Calculates next difficulty based on student performance
 * 2. Determines mastery scores
 * 3. Identifies when to suggest tutor intervention
 * 4. Tracks learning progress over time
 */

import {
  StudyBuddyProgress,
  StudyBuddyQuizAttempt,
  DifficultyDecision,
  Difficulty,
  PerformanceMetrics,
  DIFFICULTY_THRESHOLDS,
} from "../../../shared/studyBuddyTypes";
import { Timestamp } from "firebase-admin/firestore";

// ============================================================================
// MAIN ALGORITHM
// ============================================================================

/**
 * Calculate the next difficulty level based on student performance
 */
export function calculateNextDifficulty(
  progress: StudyBuddyProgress,
  lastAttempt: StudyBuddyQuizAttempt
): DifficultyDecision {
  // Extract performance metrics
  const metrics = extractPerformanceMetrics(progress, lastAttempt);

  // Check if tutor intervention is needed
  const tutorCheck = checkTutorIntervention(progress, metrics);

  // Determine difficulty adjustment
  const difficultyAdjustment = determineDifficultyAdjustment(
    metrics,
    progress.currentDifficulty
  );

  return {
    nextDifficulty: difficultyAdjustment.difficulty,
    confidence: calculateConfidence(progress.totalAttempts),
    reasoning: difficultyAdjustment.reasoning,
    shouldSuggestTutor: tutorCheck.shouldSuggest,
    tutorSuggestionReason: tutorCheck.reason,
  };
}

/**
 * Calculate mastery score (0-100) for a topic
 */
export function calculateMasteryScore(progress: StudyBuddyProgress): number {
  if (progress.totalAttempts === 0) return 0;

  // Base accuracy score (0-70 points)
  const accuracy = progress.correctAnswers / progress.totalAttempts;
  let score = accuracy * 70;

  // Difficulty multiplier (0-20 points)
  const difficultyMultiplier = {
    easy: 0.5,
    medium: 0.75,
    hard: 1.0,
  }[progress.currentDifficulty];
  score += difficultyMultiplier * 20;

  // Recency bonus (0-10 points)
  // Decays over 30 days - recent practice gets bonus points
  const daysSinceLastPractice = getDaysSince(progress.lastPracticed);
  const recencyBonus = Math.max(0, 1 - daysSinceLastPractice / 30);
  score += recencyBonus * 10;

  // Consistency bonus (up to 5 points)
  // Reward for practicing regularly
  if (progress.totalAttempts >= 5) {
    const consistencyBonus = Math.min(progress.totalAttempts / 20, 1) * 5;
    score += consistencyBonus;
  }

  // Penalize if consecutive failures
  if (progress.consecutiveIncorrect >= 3) {
    score *= 0.8; // 20% penalty
  }

  return Math.round(Math.min(score, 100));
}

/**
 * Update progress after quiz attempt
 */
export function updateProgressFromAttempt(
  currentProgress: StudyBuddyProgress,
  attempt: StudyBuddyQuizAttempt
): Partial<StudyBuddyProgress> {
  const totalAttempts = currentProgress.totalAttempts + 1;
  const correctAnswers = currentProgress.correctAnswers + attempt.correctCount;
  const incorrectAnswers =
    currentProgress.incorrectAnswers +
    (attempt.totalQuestions - attempt.correctCount);

  // Calculate average time
  const totalTime =
    currentProgress.averageTimeSeconds * currentProgress.totalAttempts;
  const attemptTotalTime = attempt.answers.reduce(
    (sum, ans) => sum + ans.timeSpentSeconds,
    0
  );
  const averageTimeSeconds = (totalTime + attemptTotalTime) / totalAttempts;

  // Update consecutive streaks
  let consecutiveCorrect = currentProgress.consecutiveCorrect;
  let consecutiveIncorrect = currentProgress.consecutiveIncorrect;

  const attemptAccuracy = attempt.score / 100;
  if (attemptAccuracy >= 0.7) {
    // Good performance
    consecutiveCorrect += 1;
    consecutiveIncorrect = 0;
  } else if (attemptAccuracy < 0.5) {
    // Poor performance
    consecutiveIncorrect += 1;
    consecutiveCorrect = 0;
  } else {
    // Medium performance - no change to streaks
  }

  // Extract weak areas and strengths from the attempt
  const weakAreas = extractWeakAreas(attempt);
  const strengths = extractStrengths(attempt);

  // Merge with existing weak areas and strengths
  const updatedWeakAreas = Array.from(
    new Set([...currentProgress.weakAreas, ...weakAreas])
  ).slice(0, 10); // Keep top 10
  const updatedStrengths = Array.from(
    new Set([...currentProgress.strengths, ...strengths])
  ).slice(0, 10); // Keep top 10

  // Calculate next difficulty
  const difficultyDecision = calculateNextDifficulty(
    {
      ...currentProgress,
      totalAttempts,
      correctAnswers,
      incorrectAnswers,
      consecutiveCorrect,
      consecutiveIncorrect,
    },
    attempt
  );

  // Calculate updated mastery score
  const updatedProgress = {
    ...currentProgress,
    totalAttempts,
    correctAnswers,
    incorrectAnswers,
    averageTimeSeconds,
    consecutiveCorrect,
    consecutiveIncorrect,
    weakAreas: updatedWeakAreas,
    strengths: updatedStrengths,
  };
  const masteryScore = calculateMasteryScore(updatedProgress);

  return {
    totalAttempts,
    correctAnswers,
    incorrectAnswers,
    averageTimeSeconds,
    consecutiveCorrect,
    consecutiveIncorrect,
    weakAreas: updatedWeakAreas,
    strengths: updatedStrengths,
    currentDifficulty: difficultyDecision.nextDifficulty,
    recommendedNextDifficulty: difficultyDecision.nextDifficulty,
    needsTutorIntervention: difficultyDecision.shouldSuggestTutor,
    masteryScore,
    lastPracticed: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract performance metrics from progress and attempt
 */
function extractPerformanceMetrics(
  progress: StudyBuddyProgress,
  lastAttempt: StudyBuddyQuizAttempt
): PerformanceMetrics {
  const recentAccuracy = lastAttempt.score / 100;
  const overallAccuracy =
    progress.totalAttempts > 0
      ? progress.correctAnswers / progress.totalAttempts
      : 0;

  const averageSpeed =
    lastAttempt.answers.reduce((sum, ans) => sum + ans.timeSpentSeconds, 0) /
    lastAttempt.answers.length;

  const consecutiveStreak =
    progress.consecutiveCorrect - progress.consecutiveIncorrect;

  return {
    recentAccuracy,
    overallAccuracy,
    averageSpeed,
    consecutiveStreak,
    totalAttempts: progress.totalAttempts + 1,
    currentDifficulty: progress.currentDifficulty,
  };
}

/**
 * Check if tutor intervention is needed
 */
function checkTutorIntervention(
  progress: StudyBuddyProgress,
  metrics: PerformanceMetrics
): { shouldSuggest: boolean; reason?: string } {
  // Rule 1: Consecutive failures
  if (progress.consecutiveIncorrect >= DIFFICULTY_THRESHOLDS.TUTOR_THRESHOLD) {
    return {
      shouldSuggest: true,
      reason: `You've struggled with ${progress.consecutiveIncorrect} consecutive quizzes. A tutor could provide personalized guidance to help you improve.`,
    };
  }

  // Rule 2: Low mastery with many attempts
  const masteryScore = calculateMasteryScore(progress);
  if (masteryScore < 40 && progress.totalAttempts >= 5) {
    return {
      shouldSuggest: true,
      reason: `After ${progress.totalAttempts} attempts, your mastery is still at ${masteryScore}%. A tutor could help you break through this learning plateau.`,
    };
  }

  // Rule 3: Declining performance
  if (
    metrics.recentAccuracy < 0.4 &&
    metrics.overallAccuracy > metrics.recentAccuracy + 0.2
  ) {
    return {
      shouldSuggest: true,
      reason: `Your recent performance has declined. A tutor can help identify what's causing the difficulty.`,
    };
  }

  // Rule 4: Stuck on easy difficulty
  if (
    progress.currentDifficulty === "easy" &&
    progress.totalAttempts >= 8 &&
    metrics.overallAccuracy < 0.6
  ) {
    return {
      shouldSuggest: true,
      reason: `You're having trouble with basic concepts. A tutor can help build a strong foundation.`,
    };
  }

  return { shouldSuggest: false };
}

/**
 * Determine difficulty adjustment
 */
function determineDifficultyAdjustment(
  metrics: PerformanceMetrics,
  currentDifficulty: Difficulty
): { difficulty: Difficulty; reasoning: string } {
  const { recentAccuracy, consecutiveStreak } = metrics;

  // UPGRADE DIFFICULTY
  if (
    recentAccuracy >= DIFFICULTY_THRESHOLDS.UPGRADE_THRESHOLD &&
    consecutiveStreak >= 2
  ) {
    if (currentDifficulty === "easy") {
      return {
        difficulty: "medium",
        reasoning:
          "Great work! You're consistently scoring well. Let's try medium difficulty questions.",
      };
    } else if (currentDifficulty === "medium") {
      return {
        difficulty: "hard",
        reasoning:
          "Excellent progress! You're ready for challenging questions.",
      };
    } else {
      return {
        difficulty: "hard",
        reasoning: "Outstanding! Keep challenging yourself at this level.",
      };
    }
  }

  // DOWNGRADE DIFFICULTY
  if (recentAccuracy < DIFFICULTY_THRESHOLDS.DOWNGRADE_THRESHOLD) {
    if (currentDifficulty === "hard") {
      return {
        difficulty: "medium",
        reasoning:
          "Let's consolidate your understanding with medium-level questions.",
      };
    } else if (currentDifficulty === "medium") {
      return {
        difficulty: "easy",
        reasoning:
          "Building confidence with fundamentals before progressing.",
      };
    } else {
      return {
        difficulty: "easy",
        reasoning: "Keep practicing the basics - you'll improve with time!",
      };
    }
  }

  // MAINTAIN CURRENT DIFFICULTY
  let reasoning: string;
  if (recentAccuracy >= 0.7) {
    reasoning = "Good progress! Continue practicing at this level.";
  } else if (recentAccuracy >= 0.5) {
    reasoning =
      "You're making steady progress. Keep working on the weak areas.";
  } else {
    reasoning =
      "Don't give up! Focus on understanding the fundamentals before moving forward.";
  }

  return {
    difficulty: currentDifficulty,
    reasoning,
  };
}

/**
 * Calculate confidence score based on sample size
 * More attempts = higher confidence in difficulty assessment
 */
function calculateConfidence(totalAttempts: number): number {
  // Confidence increases with attempts, maxing out at 10 attempts
  return Math.min(totalAttempts / 10, 1.0);
}

/**
 * Extract weak areas from quiz attempt
 */
function extractWeakAreas(attempt: StudyBuddyQuizAttempt): string[] {
  const weakAreas: string[] = [];

  // Find questions that were answered incorrectly
  attempt.answers.forEach((answer) => {
    if (!answer.isCorrect) {
      // Find the corresponding question to get the topic
      const question = attempt.difficultyProgression.find(
        (q) => q.questionId === answer.questionId
      );
      if (question) {
        // Extract topic from questionId or use a default
        // In a real implementation, you'd fetch the actual question
        // to get the topic name
        weakAreas.push(`Question ${answer.questionId.substring(0, 8)}`);
      }
    }
  });

  return weakAreas;
}

/**
 * Extract strengths from quiz attempt
 */
function extractStrengths(attempt: StudyBuddyQuizAttempt): string[] {
  const strengths: string[] = [];

  // Find questions that were answered correctly and quickly
  const averageTime =
    attempt.answers.reduce((sum, ans) => sum + ans.timeSpentSeconds, 0) /
    attempt.answers.length;

  attempt.answers.forEach((answer) => {
    if (answer.isCorrect && answer.timeSpentSeconds <= averageTime) {
      // Correctly answered and faster than average = strength
      strengths.push(`Question ${answer.questionId.substring(0, 8)}`);
    }
  });

  return strengths;
}

/**
 * Calculate days since a timestamp
 */
function getDaysSince(timestamp: Timestamp): number {
  const now = Date.now();
  const then = timestamp.toMillis();
  return (now - then) / (1000 * 60 * 60 * 24);
}

// ============================================================================
// DIFFICULTY RECOMMENDATION FOR NEW STUDENTS
// ============================================================================

/**
 * Recommend starting difficulty for a student with no progress data
 */
export function recommendStartingDifficulty(
  context?: {
    selfAssessment?: "beginner" | "intermediate" | "advanced";
    recentSessionScores?: number[];
  }
): Difficulty {
  // If no context, start with easy
  if (!context) return "easy";

  // Use self-assessment if available
  if (context.selfAssessment) {
    const difficultyMap = {
      beginner: "easy" as Difficulty,
      intermediate: "medium" as Difficulty,
      advanced: "hard" as Difficulty,
    };
    return difficultyMap[context.selfAssessment];
  }

  // Use recent session scores if available
  if (context.recentSessionScores && context.recentSessionScores.length > 0) {
    const avgScore =
      context.recentSessionScores.reduce((a, b) => a + b, 0) /
      context.recentSessionScores.length;

    if (avgScore >= 80) return "hard";
    if (avgScore >= 60) return "medium";
    return "easy";
  }

  // Default to easy for safety
  return "easy";
}

// ============================================================================
// PROGRESS ANALYTICS
// ============================================================================

/**
 * Generate learning insights from progress data
 */
export interface LearningInsights {
  overallTrend: "improving" | "stable" | "declining";
  strengthsCount: number;
  weakAreasCount: number;
  recommendedFocus: string[];
  estimatedTimeToMastery: number; // Days
  motivationalMessage: string;
}

export function generateLearningInsights(
  progress: StudyBuddyProgress
): LearningInsights {
  const masteryScore = calculateMasteryScore(progress);

  // Determine trend
  let overallTrend: "improving" | "stable" | "declining" = "stable";
  if (progress.consecutiveCorrect >= 2) {
    overallTrend = "improving";
  } else if (progress.consecutiveIncorrect >= 2) {
    overallTrend = "declining";
  }

  // Estimate time to mastery
  const currentMastery = masteryScore;
  const pointsToGo = Math.max(0, DIFFICULTY_THRESHOLDS.MASTERY_THRESHOLD - currentMastery);

  // Assume ~5 points improvement per focused study session
  const sessionsNeeded = Math.ceil(pointsToGo / 5);
  const estimatedTimeToMastery = sessionsNeeded; // In days (assuming 1 session per day)

  // Recommended focus
  const recommendedFocus = [...progress.weakAreas].slice(0, 3);

  // Motivational message
  let motivationalMessage: string;
  if (masteryScore >= 85) {
    motivationalMessage = "You're mastering this topic! Keep up the excellent work! 🌟";
  } else if (masteryScore >= 70) {
    motivationalMessage = "You're making great progress! You're almost there! 💪";
  } else if (masteryScore >= 50) {
    motivationalMessage = "Good effort! Keep practicing and you'll improve! 📚";
  } else if (overallTrend === "improving") {
    motivationalMessage = "You're on the right track! Keep going! 🚀";
  } else {
    motivationalMessage = "Don't give up! Every expert was once a beginner. Consider getting help from a tutor! 💡";
  }

  return {
    overallTrend,
    strengthsCount: progress.strengths.length,
    weakAreasCount: progress.weakAreas.length,
    recommendedFocus,
    estimatedTimeToMastery,
    motivationalMessage,
  };
}

/**
 * Compare progress between two time periods
 */
export interface ProgressComparison {
  masteryScoreChange: number;
  accuracyChange: number;
  attemptsDifference: number;
  trend: "improved" | "declined" | "no_change";
}

export function compareProgress(
  oldProgress: StudyBuddyProgress,
  newProgress: StudyBuddyProgress
): ProgressComparison {
  const oldMastery = calculateMasteryScore(oldProgress);
  const newMastery = calculateMasteryScore(newProgress);
  const masteryScoreChange = newMastery - oldMastery;

  const oldAccuracy =
    oldProgress.totalAttempts > 0
      ? oldProgress.correctAnswers / oldProgress.totalAttempts
      : 0;
  const newAccuracy =
    newProgress.totalAttempts > 0
      ? newProgress.correctAnswers / newProgress.totalAttempts
      : 0;
  const accuracyChange = newAccuracy - oldAccuracy;

  const attemptsDifference = newProgress.totalAttempts - oldProgress.totalAttempts;

  let trend: "improved" | "declined" | "no_change";
  if (masteryScoreChange > 5) {
    trend = "improved";
  } else if (masteryScoreChange < -5) {
    trend = "declined";
  } else {
    trend = "no_change";
  }

  return {
    masteryScoreChange,
    accuracyChange,
    attemptsDifference,
    trend,
  };
}
