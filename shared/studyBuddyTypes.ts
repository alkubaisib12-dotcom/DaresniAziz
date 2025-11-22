/**
 * Study Buddy System - TypeScript Type Definitions
 *
 * This file contains all type definitions for the AI Study Buddy feature.
 * These types are shared between client and server.
 */

import { Timestamp } from "firebase-admin/firestore";

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export type Difficulty = "easy" | "medium" | "hard";
export type MessageRole = "user" | "assistant" | "system";
export type SummaryType = "brief" | "detailed" | "bullet_points";
export type KnowledgeLevel = "beginner" | "intermediate" | "advanced";
export type UpsellPriority = "low" | "medium" | "high";
export type ActionType = "quiz" | "summary" | "revision_plan" | "progress_check";

// ============================================================================
// FIRESTORE DOCUMENT TYPES
// ============================================================================

/**
 * Study Buddy Conversation
 * Collection: study_buddy_conversations
 */
export interface StudyBuddyConversation {
  conversationId: string;
  userId: string;
  title: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  messageCount: number;
  lastMessage: string;
  lastMessageAt: Timestamp;
}

/**
 * Study Buddy Message
 * Collection: study_buddy_messages
 */
export interface StudyBuddyMessage {
  messageId: string;
  conversationId: string;
  userId: string;
  role: MessageRole;
  content: string;
  timestamp: Timestamp;
  metadata?: {
    actionType?: ActionType;
    relatedQuizId?: string;
    relatedSessionId?: string;
    suggestedTutor?: boolean;
    tutorIds?: string[];
    streamingComplete?: boolean;
  };
}

/**
 * Study Buddy Progress Tracking
 * Collection: study_buddy_progress
 */
export interface StudyBuddyProgress {
  progressId: string;
  userId: string;
  topicId: string;
  subjectId: string;
  topicName: string;

  // Performance metrics
  totalAttempts: number;
  correctAnswers: number;
  incorrectAnswers: number;
  averageTimeSeconds: number;

  // Difficulty tracking
  currentDifficulty: Difficulty;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;

  // Learning insights
  weakAreas: string[];
  strengths: string[];
  lastPracticed: Timestamp;
  masteryScore: number; // 0-100

  // Adaptive flags
  needsTutorIntervention: boolean;
  recommendedNextDifficulty: Difficulty;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Quiz Question
 */
export interface QuizQuestion {
  questionId: string;
  questionText: string;
  options: string[];
  correctAnswer: string | number;
  explanation: string;
  difficulty: Difficulty;
  topic: string;
  subTopic?: string;
}

/**
 * Study Buddy Quiz
 * Collection: study_buddy_quizzes
 */
export interface StudyBuddyQuiz {
  quizId: string;
  userId: string;
  conversationId?: string;

  // Quiz metadata
  subjectId: string;
  subjectName: string;
  topic: string;
  difficulty: Difficulty;
  generatedAt: Timestamp;

  // Questions
  questions: QuizQuestion[];

  // Settings
  timeLimit?: number; // In seconds
  adaptiveMode: boolean;

  // Status
  status: "active" | "completed" | "abandoned";
}

/**
 * Quiz Answer
 */
export interface QuizAnswer {
  questionId: string;
  userAnswer: string | number;
  isCorrect: boolean;
  timeSpentSeconds: number;
}

/**
 * Study Buddy Quiz Attempt
 * Collection: study_buddy_quiz_attempts
 */
export interface StudyBuddyQuizAttempt {
  attemptId: string;
  quizId: string;
  userId: string;
  conversationId?: string;

  // Attempt data
  startedAt: Timestamp;
  completedAt?: Timestamp;

  // Answers
  answers: QuizAnswer[];

  // Results
  score: number; // Percentage 0-100
  totalQuestions: number;
  correctCount: number;

  // Adaptive results
  difficultyProgression: Array<{
    questionId: string;
    difficulty: Difficulty;
  }>;

  // Recommendations
  recommendedNextDifficulty: Difficulty;
  suggestTutor: boolean;
  tutorSuggestionReason?: string;
}

/**
 * Daily Task for Revision Plan
 */
export interface DailyTask {
  taskId: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  topic: string;
  difficulty: Difficulty;
  completed: boolean;
  completedAt?: Timestamp;
}

/**
 * Study Buddy Revision Plan
 * Collection: study_buddy_revision_plans
 */
export interface StudyBuddyRevisionPlan {
  planId: string;
  userId: string;
  conversationId?: string;

  // Plan details
  subjectId: string;
  subjectName: string;
  examDate: Timestamp;
  createdAt: Timestamp;

  // Schedule
  dailyTasks: Array<{
    date: string; // YYYY-MM-DD format
    tasks: DailyTask[];
  }>;

  // Personalization
  focusAreas: string[]; // Weak topics to prioritize
  totalEstimatedHours: number;
  dailyStudyHours: number;

  // Progress
  completionPercentage: number;
  lastUpdated: Timestamp;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Chat Request
 */
export interface ChatRequest {
  conversationId?: string;
  message: string;
  includeContext?: boolean;
}

/**
 * Chat Response (Streaming)
 */
export interface ChatStreamEvent {
  type: "token" | "complete" | "error" | "upsell" | "action";
  content?: string;
  messageId?: string;
  conversationId?: string;
  error?: string;
  suggestion?: TutorUpsellSuggestion;
  action?: {
    type: ActionType;
    data: any;
  };
}

/**
 * Quiz Generation Request
 */
export interface QuizGenerationRequest {
  subjectId: string;
  topic?: string;
  difficulty?: Difficulty;
  questionCount?: number;
  conversationId?: string;
}

/**
 * Quiz Generation Response
 */
export interface QuizGenerationResponse {
  quizId: string;
  questions: QuizQuestion[];
  difficulty: Difficulty;
  estimatedTimeMinutes: number;
  topic: string;
  subjectName: string;
}

/**
 * Quiz Submission Request
 */
export interface QuizSubmissionRequest {
  answers: Array<{
    questionId: string;
    answer: string | number;
    timeSpentSeconds: number;
  }>;
}

/**
 * Quiz Submission Response
 */
export interface QuizSubmissionResponse {
  attemptId: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  feedback: string;
  detailedResults: Array<{
    questionId: string;
    correct: boolean;
    explanation: string;
  }>;
  nextDifficulty: Difficulty;
  shouldSuggestTutor: boolean;
  tutorSuggestion?: TutorUpsellSuggestion;
  progressUpdate: {
    masteryScore: number;
    weakAreas: string[];
    strengths: string[];
  };
}

/**
 * Summary Generation Request
 */
export interface SummaryRequest {
  content: string;
  summaryType: SummaryType;
  maxLength?: number;
  conversationId?: string;
}

/**
 * Summary Generation Response
 */
export interface SummaryResponse {
  summary: string;
  keyPoints: string[];
  generatedAt: string;
  wordCount: number;
}

/**
 * Revision Plan Request
 */
export interface RevisionPlanRequest {
  subjectId: string;
  examDate: string; // ISO date string
  currentKnowledgeLevel?: KnowledgeLevel;
  dailyStudyHours?: number;
  conversationId?: string;
}

/**
 * Revision Plan Response
 */
export interface RevisionPlanResponse {
  planId: string;
  dailyTasks: Array<{
    date: string;
    tasks: DailyTask[];
  }>;
  totalEstimatedHours: number;
  focusAreas: string[];
  subjectName: string;
  daysUntilExam: number;
}

/**
 * Progress Summary Request
 */
export interface ProgressRequest {
  subjectId?: string; // Optional: filter by subject
  timeRange?: "week" | "month" | "all";
}

/**
 * Topic Progress
 */
export interface TopicProgress {
  subjectId: string;
  subjectName: string;
  topicId: string;
  topicName: string;
  masteryScore: number;
  weakAreas: string[];
  strengths: string[];
  lastPracticed: string; // ISO date string
  totalAttempts: number;
  accuracyRate: number;
}

/**
 * Recent Activity
 */
export interface RecentActivity {
  activityId: string;
  type: "quiz" | "chat" | "revision_plan" | "summary";
  description: string;
  timestamp: string; // ISO date string
  score?: number;
  relatedSubject?: string;
}

/**
 * Progress Response
 */
export interface ProgressResponse {
  overallMasteryScore: number;
  topicProgress: TopicProgress[];
  recentActivity: RecentActivity[];
  recommendations: string[];
  studyStreak: number; // Days
  totalStudyTime: number; // Minutes
  quizzesCompleted: number;
}

// ============================================================================
// TUTOR UPSELL TYPES
// ============================================================================

/**
 * Upsell Decision Context
 */
export interface UpsellContext {
  userMessage: string;
  progress?: StudyBuddyProgress;
  recentAttempts?: StudyBuddyQuizAttempt[];
  conversationHistory: StudyBuddyMessage[];
  conversationLength: number;
}

/**
 * Upsell Decision
 */
export interface UpsellDecision {
  shouldUpsell: boolean;
  priority: UpsellPriority;
  reason: string;
  triggerType:
    | "assignment_help"
    | "repeated_failure"
    | "low_mastery"
    | "complex_topic"
    | "long_conversation"
    | "user_request"
    | "none";
  suggestedTutorSpecialization?: string;
}

/**
 * Tutor Upsell Suggestion
 */
export interface TutorUpsellSuggestion {
  priority: UpsellPriority;
  message: string;
  reason: string;
  recommendedTutors?: Array<{
    tutorId: string;
    name: string;
    rating: number;
    specialization: string;
    pricePerHour: number;
    availability: "available" | "limited" | "busy";
  }>;
  ctaButtons: Array<{
    label: string;
    action: "view_tutors" | "book_session" | "dismiss";
    tutorId?: string;
  }>;
}

// ============================================================================
// ADAPTIVE DIFFICULTY TYPES
// ============================================================================

/**
 * Difficulty Decision
 */
export interface DifficultyDecision {
  nextDifficulty: Difficulty;
  confidence: number; // 0-1
  reasoning: string;
  shouldSuggestTutor: boolean;
  tutorSuggestionReason?: string;
}

/**
 * Performance Metrics for Difficulty Calculation
 */
export interface PerformanceMetrics {
  recentAccuracy: number; // 0-1
  overallAccuracy: number; // 0-1
  averageSpeed: number; // Seconds per question
  consecutiveStreak: number; // Positive for correct, negative for incorrect
  totalAttempts: number;
  currentDifficulty: Difficulty;
}

// ============================================================================
// STUDENT CONTEXT TYPES
// ============================================================================

/**
 * Student Context for AI
 * Aggregated data passed to Claude for personalization
 */
export interface StudentContext {
  userId: string;
  firstName?: string;

  // Enrolled courses
  enrolledSubjects: Array<{
    subjectId: string;
    subjectName: string;
    description?: string;
  }>;

  // Recent sessions with tutors
  recentSessions?: Array<{
    sessionId: string;
    subjectName: string;
    tutorName: string;
    date: string;
    notes?: string;
    aiSummary?: {
      whatWasLearned: string;
      mistakes: string;
      strengths: string;
      practiceTasks: string;
    };
  }>;

  // Progress data
  progressBySubject: Array<{
    subjectId: string;
    subjectName: string;
    masteryScore: number;
    weakAreas: string[];
    strengths: string[];
    lastPracticed: string;
  }>;

  // Recent quiz performance
  recentQuizzes?: Array<{
    quizId: string;
    topic: string;
    difficulty: Difficulty;
    score: number;
    date: string;
  }>;

  // Upcoming deadlines (future integration)
  upcomingExams?: Array<{
    subjectId: string;
    subjectName: string;
    examDate: string;
    daysUntil: number;
  }>;

  // Study patterns
  preferredStudyTime?: "morning" | "afternoon" | "evening" | "night";
  studyStreak: number;
  totalStudyTimHours: number;
}

/**
 * Context Builder Options
 */
export interface ContextBuilderOptions {
  includeRecentSessions?: boolean;
  includeQuizHistory?: boolean;
  includeProgressData?: boolean;
  sessionsLimit?: number;
  quizzesLimit?: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * API Error Response
 */
export interface APIError {
  error: string;
  message: string;
  statusCode: number;
  details?: any;
}

/**
 * Success Response Wrapper
 */
export interface APISuccess<T> {
  success: true;
  data: T;
  timestamp: string;
}

/**
 * Paginated Response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// FRONTEND-SPECIFIC TYPES
// ============================================================================

/**
 * Chat UI State
 */
export interface ChatUIState {
  isOpen: boolean;
  isLoading: boolean;
  isStreaming: boolean;
  currentConversationId?: string;
  error?: string;
}

/**
 * Quiz UI State
 */
export interface QuizUIState {
  quizId?: string;
  currentQuestionIndex: number;
  answers: Map<string, string | number>;
  timeSpent: Map<string, number>;
  isSubmitting: boolean;
  results?: QuizSubmissionResponse;
}

/**
 * Message Display Type
 */
export interface MessageDisplay extends StudyBuddyMessage {
  isStreaming?: boolean;
  error?: boolean;
  displayTime: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const DIFFICULTY_THRESHOLDS = {
  UPGRADE_THRESHOLD: 0.8, // 80% accuracy to increase difficulty
  DOWNGRADE_THRESHOLD: 0.5, // Below 50% to decrease difficulty
  TUTOR_THRESHOLD: 3, // 3 consecutive failures → suggest tutor
  MASTERY_THRESHOLD: 75, // 75+ mastery score = topic mastered
} as const;

export const DEFAULT_VALUES = {
  QUESTION_COUNT: 5,
  DAILY_STUDY_HOURS: 2,
  MAX_SUMMARY_WORDS: 500,
  QUIZ_TIME_LIMIT_SECONDS: 300, // 5 minutes
  CONTEXT_SESSIONS_LIMIT: 5,
  CONTEXT_QUIZZES_LIMIT: 10,
} as const;

export const UPSELL_TRIGGERS = {
  ASSIGNMENT_KEYWORDS: [
    "assignment",
    "homework",
    "project",
    "do my",
    "solve this for me",
    "give me the answer",
    "complete this",
  ],
  COMPLEX_KEYWORDS: [
    "advanced",
    "graduate level",
    "research",
    "thesis",
    "don't understand at all",
    "completely lost",
    "confused",
  ],
} as const;
