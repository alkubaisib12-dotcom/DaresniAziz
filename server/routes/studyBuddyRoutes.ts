/**
 * Study Buddy API Routes
 *
 * All API endpoints for the AI Study Buddy feature
 */

import { Router } from "express";
import { requireUser } from "../firebase-admin";
import { handleChatMessage, getUserConversations, deleteConversation } from "../services/study-buddy/studyBuddyService";
import { generateQuiz, gradeQuiz } from "../services/study-buddy/quizGenerator";
import {
  generateRevisionPlan,
  markTaskCompleted,
  getRevisionPlan,
  getUserRevisionPlans,
} from "../services/study-buddy/revisionPlanner";
import { updateProgressFromAttempt } from "../services/study-buddy/adaptiveDifficulty";
import { buildStudentContext } from "../services/study-buddy/contextBuilder";
import { db } from "../firebase-admin";
import {
  ChatRequest,
  QuizGenerationRequest,
  QuizSubmissionRequest,
  RevisionPlanRequest,
  ProgressRequest,
  ProgressResponse,
  StudyBuddyQuizAttempt,
  StudyBuddyQuiz,
  RecentActivity,
} from "../../shared/studyBuddyTypes";
import { Timestamp } from "firebase-admin/firestore";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ============================================================================
// CHAT ENDPOINTS
// ============================================================================

/**
 * POST /api/study-buddy/chat
 * Stream chat responses with personalization
 */
router.post("/chat", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const chatRequest: ChatRequest = req.body;

    await handleChatMessage(chatRequest, userId, res);
  } catch (error) {
    console.error("Error in /api/study-buddy/chat:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to process chat message" });
    }
  }
});

/**
 * GET /api/study-buddy/conversations
 * Get all conversations for current user
 */
router.get("/conversations", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const conversations = await getUserConversations(userId);

    res.json(conversations);
  } catch (error) {
    console.error("Error in /api/study-buddy/conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

/**
 * DELETE /api/study-buddy/conversations/:conversationId
 * Delete a conversation
 */
router.delete("/conversations/:conversationId", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { conversationId } = req.params;

    await deleteConversation(conversationId, userId);

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error in DELETE /api/study-buddy/conversations:", error);
    res.status(error.message === "Unauthorized" ? 403 : 500).json({
      error: error.message || "Failed to delete conversation",
    });
  }
});

/**
 * GET /api/study-buddy/conversations/:conversationId/messages
 * Get messages for a conversation
 */
router.get("/conversations/:conversationId/messages", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { conversationId } = req.params;

    // Verify ownership
    const conversationDoc = await db
      .collection("study_buddy_conversations")
      .doc(conversationId)
      .get();

    if (!conversationDoc.exists) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const conversation = conversationDoc.data();
    if (conversation?.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Fetch messages
    const messagesSnapshot = await db
      .collection("study_buddy_messages")
      .where("conversationId", "==", conversationId)
      .orderBy("timestamp", "asc")
      .get();

    const messages = messagesSnapshot.docs.map((doc) => doc.data());

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// ============================================================================
// QUIZ ENDPOINTS
// ============================================================================

/**
 * POST /api/study-buddy/quiz
 * Generate an adaptive quiz
 */
router.post("/quiz", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const request: QuizGenerationRequest = req.body;

    const quizResponse = await generateQuiz(request, userId);

    res.json(quizResponse);
  } catch (error: any) {
    console.error("Error in /api/study-buddy/quiz:", error);
    res.status(500).json({ error: error.message || "Failed to generate quiz" });
  }
});

/**
 * POST /api/study-buddy/quiz/:quizId/submit
 * Submit quiz answers and get results
 */
router.post("/quiz/:quizId/submit", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { quizId } = req.params;
    const submission: QuizSubmissionRequest = req.body;

    // Fetch quiz
    const quizDoc = await db.collection("study_buddy_quizzes").doc(quizId).get();

    if (!quizDoc.exists) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const quiz = quizDoc.data() as StudyBuddyQuiz;

    // Verify ownership
    if (quiz.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Grade the quiz
    const gradeResult = gradeQuiz(quiz, submission.answers);

    // Create quiz attempt
    const attemptId = db.collection("study_buddy_quiz_attempts").doc().id;
    const attempt: StudyBuddyQuizAttempt = {
      attemptId,
      quizId,
      userId,
      conversationId: quiz.conversationId,
      startedAt: Timestamp.now(),
      completedAt: Timestamp.now(),
      answers: submission.answers.map((ans) => {
        const question = quiz.questions.find((q) => q.questionId === ans.questionId);
        return {
          questionId: ans.questionId,
          userAnswer: ans.answer,
          isCorrect: ans.answer === question?.correctAnswer,
          timeSpentSeconds: ans.timeSpentSeconds,
        };
      }),
      score: gradeResult.score,
      totalQuestions: gradeResult.totalQuestions,
      correctCount: gradeResult.correctCount,
      difficultyProgression: quiz.questions.map((q) => ({
        questionId: q.questionId,
        difficulty: q.difficulty,
      })),
      recommendedNextDifficulty: quiz.difficulty, // Will be updated by adaptive algorithm
      suggestTutor: false, // Will be determined by adaptive algorithm
    };

    // Save attempt
    await db.collection("study_buddy_quiz_attempts").doc(attemptId).set(attempt);

    // Update or create progress
    const progressId = `${userId}_${quiz.subjectId}_${quiz.topic}`;
    const progressDoc = await db
      .collection("study_buddy_progress")
      .doc(progressId)
      .get();

    let progressUpdate;
    if (progressDoc.exists) {
      const currentProgress = progressDoc.data();
      progressUpdate = updateProgressFromAttempt(currentProgress as any, attempt);
      await db.collection("study_buddy_progress").doc(progressId).update(progressUpdate);
    } else {
      // Create new progress
      progressUpdate = {
        progressId,
        userId,
        topicId: quiz.topic,
        subjectId: quiz.subjectId,
        topicName: quiz.topic,
        totalAttempts: 1,
        correctAnswers: gradeResult.correctCount,
        incorrectAnswers: gradeResult.totalQuestions - gradeResult.correctCount,
        averageTimeSeconds:
          submission.answers.reduce((sum, ans) => sum + ans.timeSpentSeconds, 0) /
          submission.answers.length,
        currentDifficulty: quiz.difficulty,
        consecutiveCorrect: gradeResult.score >= 70 ? 1 : 0,
        consecutiveIncorrect: gradeResult.score < 50 ? 1 : 0,
        weakAreas: [],
        strengths: [],
        lastPracticed: Timestamp.now(),
        masteryScore: gradeResult.score,
        needsTutorIntervention: gradeResult.score < 40,
        recommendedNextDifficulty: quiz.difficulty,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      await db.collection("study_buddy_progress").doc(progressId).set(progressUpdate);
    }

    // Update quiz status
    await db.collection("study_buddy_quizzes").doc(quizId).update({
      status: "completed",
    });

    // Build response with feedback
    const feedbackPrompt = `Generate encouraging, personalized feedback for a student who scored ${gradeResult.score}% on a ${quiz.difficulty} ${quiz.topic} quiz. Keep it to 2-3 sentences.`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const feedbackResponse = await model.generateContent(feedbackPrompt);
    const feedback = feedbackResponse.response.text() || "Great effort! Keep practicing to improve.";

    res.json({
      attemptId,
      score: gradeResult.score,
      correctCount: gradeResult.correctCount,
      totalQuestions: gradeResult.totalQuestions,
      feedback,
      detailedResults: gradeResult.detailedResults,
      nextDifficulty: progressUpdate.recommendedNextDifficulty || quiz.difficulty,
      shouldSuggestTutor: progressUpdate.needsTutorIntervention || false,
      progressUpdate: {
        masteryScore: progressUpdate.masteryScore || gradeResult.score,
        weakAreas: progressUpdate.weakAreas || [],
        strengths: progressUpdate.strengths || [],
      },
    });
  } catch (error: any) {
    console.error("Error in /api/study-buddy/quiz/:quizId/submit:", error);
    res.status(500).json({ error: error.message || "Failed to submit quiz" });
  }
});

// ============================================================================
// SUMMARY ENDPOINT
// ============================================================================

/**
 * POST /api/study-buddy/summary
 * Generate a summary from text
 */
router.post("/summary", requireUser, async (req, res) => {
  try {
    const { content, summaryType = "brief", maxLength = 500 } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    const prompt = `Summarize the following text as a ${summaryType} summary (max ${maxLength} words):

${content}

Provide:
1. A concise summary
2. Key points as bullet points`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const response = await model.generateContent(prompt);
    const summaryText = response.response.text() || "";

    // Extract key points (simple heuristic)
    const keyPoints: string[] = [];
    const lines = summaryText.split("\n");
    lines.forEach((line) => {
      if (line.trim().startsWith("-") || line.trim().startsWith("•")) {
        keyPoints.push(line.trim().substring(1).trim());
      }
    });

    res.json({
      summary: summaryText,
      keyPoints,
      generatedAt: new Date().toISOString(),
      wordCount: summaryText.split(/\s+/).length,
    });
  } catch (error) {
    console.error("Error in /api/study-buddy/summary:", error);
    res.status(500).json({ error: "Failed to generate summary" });
  }
});

// ============================================================================
// REVISION PLAN ENDPOINTS
// ============================================================================

/**
 * POST /api/study-buddy/revision-plan
 * Generate a personalized revision plan
 */
router.post("/revision-plan", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const request: RevisionPlanRequest = req.body;

    const plan = await generateRevisionPlan(request, userId);

    res.json(plan);
  } catch (error: any) {
    console.error("Error in /api/study-buddy/revision-plan:", error);
    res.status(500).json({ error: error.message || "Failed to generate revision plan" });
  }
});

/**
 * GET /api/study-buddy/revision-plans
 * Get all revision plans for current user
 */
router.get("/revision-plans", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const plans = await getUserRevisionPlans(userId);

    res.json(plans);
  } catch (error) {
    console.error("Error in /api/study-buddy/revision-plans:", error);
    res.status(500).json({ error: "Failed to fetch revision plans" });
  }
});

/**
 * GET /api/study-buddy/revision-plans/:planId
 * Get a specific revision plan
 */
router.get("/revision-plans/:planId", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { planId } = req.params;

    const plan = await getRevisionPlan(planId, userId);

    res.json(plan);
  } catch (error: any) {
    console.error("Error in /api/study-buddy/revision-plans/:planId:", error);
    res.status(error.message === "Unauthorized" ? 403 : 404).json({
      error: error.message || "Failed to fetch revision plan",
    });
  }
});

/**
 * PUT /api/study-buddy/revision-plans/:planId/tasks/:taskId/complete
 * Mark a task as completed
 */
router.put("/revision-plans/:planId/tasks/:taskId/complete", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { planId, taskId } = req.params;

    await markTaskCompleted(planId, taskId, userId);

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error completing task:", error);
    res.status(error.message === "Unauthorized" ? 403 : 500).json({
      error: error.message || "Failed to complete task",
    });
  }
});

// ============================================================================
// PROGRESS ENDPOINTS
// ============================================================================

/**
 * GET /api/study-buddy/progress
 * Get comprehensive progress data
 */
router.get("/progress", requireUser, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { subjectId, timeRange = "all" } = req.query;

    // Fetch all progress
    let progressQuery = db
      .collection("study_buddy_progress")
      .where("userId", "==", userId);

    if (subjectId) {
      progressQuery = progressQuery.where("subjectId", "==", subjectId as string);
    }

    const progressSnapshot = await progressQuery.get();

    // Fetch recent activity
    const recentActivity: RecentActivity[] = [];

    // Quiz attempts
    const quizAttemptsSnapshot = await db
      .collection("study_buddy_quiz_attempts")
      .where("userId", "==", userId)
      .orderBy("startedAt", "desc")
      .limit(10)
      .get();

    quizAttemptsSnapshot.docs.forEach((doc) => {
      const attempt = doc.data();
      recentActivity.push({
        activityId: doc.id,
        type: "quiz",
        description: `Completed quiz - ${attempt.score}%`,
        timestamp: attempt.startedAt?.toDate?.()?.toISOString() || "",
        score: attempt.score,
      });
    });

    // Chat messages
    const messagesSnapshot = await db
      .collection("study_buddy_messages")
      .where("userId", "==", userId)
      .where("role", "==", "user")
      .orderBy("timestamp", "desc")
      .limit(5)
      .get();

    messagesSnapshot.docs.forEach((doc) => {
      const message = doc.data();
      recentActivity.push({
        activityId: doc.id,
        type: "chat",
        description: message.content.substring(0, 50) + "...",
        timestamp: message.timestamp?.toDate?.()?.toISOString() || "",
      });
    });

    // Sort all activity by timestamp
    recentActivity.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Calculate overall metrics
    let totalMasteryScore = 0;
    const topicProgress = progressSnapshot.docs.map((doc) => {
      const progress = doc.data();
      totalMasteryScore += progress.masteryScore || 0;

      return {
        subjectId: progress.subjectId,
        subjectName: progress.topicName || "Unknown",
        topicId: progress.topicId,
        topicName: progress.topicName,
        masteryScore: progress.masteryScore || 0,
        weakAreas: progress.weakAreas || [],
        strengths: progress.strengths || [],
        lastPracticed: progress.lastPracticed?.toDate?.()?.toISOString() || "",
        totalAttempts: progress.totalAttempts || 0,
        accuracyRate:
          progress.totalAttempts > 0
            ? (progress.correctAnswers / progress.totalAttempts) * 100
            : 0,
      };
    });

    const overallMasteryScore =
      topicProgress.length > 0
        ? Math.round(totalMasteryScore / topicProgress.length)
        : 0;

    // Get study streak and total time from context
    const context = await buildStudentContext(userId, {
      includeProgressData: false,
      includeQuizHistory: false,
      includeRecentSessions: false,
    });

    const response: ProgressResponse = {
      overallMasteryScore,
      topicProgress,
      recentActivity: recentActivity.slice(0, 15),
      recommendations: generateRecommendations(topicProgress),
      studyStreak: context.studyStreak,
      totalStudyTime: context.totalStudyTimHours * 60, // Convert to minutes
      quizzesCompleted: quizAttemptsSnapshot.size,
    };

    res.json(response);
  } catch (error) {
    console.error("Error in /api/study-buddy/progress:", error);
    res.status(500).json({ error: "Failed to fetch progress" });
  }
});

/**
 * Generate recommendations based on progress
 */
function generateRecommendations(topicProgress: any[]): string[] {
  const recommendations: string[] = [];

  // Find weakest topic
  const weakestTopic = topicProgress.sort(
    (a, b) => a.masteryScore - b.masteryScore
  )[0];

  if (weakestTopic && weakestTopic.masteryScore < 60) {
    recommendations.push(
      `Focus on improving ${weakestTopic.topicName} - your mastery is at ${weakestTopic.masteryScore}%`
    );
  }

  // Find topics not practiced recently
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  topicProgress.forEach((topic) => {
    const lastPracticed = new Date(topic.lastPracticed);
    if (lastPracticed < oneWeekAgo) {
      recommendations.push(`Review ${topic.topicName} - you haven't practiced in a while`);
    }
  });

  // Add generic recommendations
  if (recommendations.length === 0) {
    recommendations.push("Keep up the great work! Try taking quizzes on new topics.");
    recommendations.push("Consider creating a revision plan for upcoming exams.");
  }

  return recommendations.slice(0, 5);
}

export default router;
