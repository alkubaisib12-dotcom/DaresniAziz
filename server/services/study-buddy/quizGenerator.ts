/**
 * Quiz Generator Service
 *
 * Generates adaptive quizzes using Google Gemini AI based on:
 * - Subject and topic
 * - Student's current difficulty level
 * - Past performance and weak areas
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  QuizQuestion,
  StudyBuddyQuiz,
  Difficulty,
  QuizGenerationRequest,
  QuizGenerationResponse,
  DEFAULT_VALUES,
} from "../../../shared/studyBuddyTypes";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../../firebase-admin";
import { recommendStartingDifficulty } from "./adaptiveDifficulty";

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Generate a quiz based on student's needs
 */
export async function generateQuiz(
  request: QuizGenerationRequest,
  userId: string
): Promise<QuizGenerationResponse> {
  const {
    subjectId,
    topic,
    questionCount = DEFAULT_VALUES.QUESTION_COUNT,
    conversationId,
  } = request;

  // Fetch subject details
  const subjectDoc = await db.collection("subjects").doc(subjectId).get();
  const subjectData = subjectDoc.data();
  const subjectName = subjectData?.name || "Unknown Subject";

  // Determine difficulty
  let difficulty = request.difficulty;
  if (!difficulty) {
    // Auto-determine from progress
    difficulty = await determineDifficulty(userId, subjectId, topic);
  }

  // Fetch student progress for personalization
  const progress = await getStudentProgress(userId, subjectId, topic);

  // Generate questions using Gemini
  const questions = await generateQuestionsWithGemini({
    subjectName,
    topic: topic || subjectName,
    difficulty,
    questionCount,
    weakAreas: progress?.weakAreas || [],
    strengths: progress?.strengths || [],
  });

  // Create quiz document in Firestore
  const quizId = db.collection("study_buddy_quizzes").doc().id;
  const quiz: StudyBuddyQuiz = {
    quizId,
    userId,
    conversationId,
    subjectId,
    subjectName,
    topic: topic || subjectName,
    difficulty,
    generatedAt: Timestamp.now(),
    questions,
    timeLimit: questionCount * 60, // 1 minute per question
    adaptiveMode: true,
    status: "active",
  };

  await db.collection("study_buddy_quizzes").doc(quizId).set(quiz);

  return {
    quizId,
    questions,
    difficulty,
    estimatedTimeMinutes: questionCount,
    topic: topic || subjectName,
    subjectName,
  };
}

/**
 * Generate questions using Gemini AI
 */
async function generateQuestionsWithGemini(params: {
  subjectName: string;
  topic: string;
  difficulty: Difficulty;
  questionCount: number;
  weakAreas: string[];
  strengths: string[];
}): Promise<QuizQuestion[]> {
  const { subjectName, topic, difficulty, questionCount, weakAreas } = params;

  const prompt = `You are an expert educator creating a quiz for a university student.

**Subject**: ${subjectName}
**Topic**: ${topic}
**Difficulty**: ${difficulty}
**Number of Questions**: ${questionCount}

${
  weakAreas.length > 0
    ? `**Student's Weak Areas**: ${weakAreas.join(", ")}
Focus some questions on these areas to help the student improve.`
    : ""
}

Generate ${questionCount} multiple-choice questions following these requirements:

1. **Difficulty Level**:
   - Easy: Basic recall and understanding
   - Medium: Application and analysis
   - Hard: Synthesis, evaluation, and complex problem-solving

2. **Question Format**:
   - Clear, unambiguous question text
   - 4 answer options (A, B, C, D)
   - Only ONE correct answer
   - Plausible distractors (wrong answers that seem reasonable)

3. **Explanation**:
   - Provide a detailed explanation for why the correct answer is right
   - Explain why other options are wrong (if helpful)

4. **Variety**:
   - Mix different types of questions (conceptual, application, problem-solving)
   - Cover different aspects of the topic

**IMPORTANT**: Respond ONLY with valid JSON in this exact format:
{
  "questions": [
    {
      "questionText": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "Detailed explanation here...",
      "difficulty": "${difficulty}",
      "topic": "${topic}",
      "subTopic": "Specific subtopic if applicable"
    }
  ]
}

Note: correctAnswer is the index (0-3) of the correct option in the options array.`;

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4000,
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?$/g, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```\n?/g, "").replace(/```\n?$/g, "");
    }

    const parsed = JSON.parse(jsonText);
    const questions: QuizQuestion[] = parsed.questions.map(
      (q: any, index: number) => ({
        questionId: `q_${Date.now()}_${index}`,
        questionText: q.questionText,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        difficulty: q.difficulty || difficulty,
        topic: q.topic || topic,
        subTopic: q.subTopic,
      })
    );

    return questions;
  } catch (error) {
    console.error("Error generating questions with Gemini:", error);

    // Fallback: generate simple questions
    return generateFallbackQuestions(topic, difficulty, questionCount);
  }
}

/**
 * Fallback question generator if Gemini API fails
 */
function generateFallbackQuestions(
  topic: string,
  difficulty: Difficulty,
  count: number
): QuizQuestion[] {
  const questions: QuizQuestion[] = [];

  for (let i = 0; i < count; i++) {
    questions.push({
      questionId: `fallback_${Date.now()}_${i}`,
      questionText: `Question ${i + 1} about ${topic} (${difficulty} difficulty)`,
      options: [
        "Option A (placeholder)",
        "Option B (placeholder)",
        "Option C (placeholder)",
        "Option D (placeholder)",
      ],
      correctAnswer: 0,
      explanation:
        "This is a placeholder question. Please try again or contact support.",
      difficulty,
      topic,
    });
  }

  return questions;
}

/**
 * Determine appropriate difficulty based on student's progress
 */
async function determineDifficulty(
  userId: string,
  subjectId: string,
  topic?: string
): Promise<Difficulty> {
  // Try to find progress for this specific topic
  let progressQuery = db
    .collection("study_buddy_progress")
    .where("userId", "==", userId)
    .where("subjectId", "==", subjectId);

  if (topic) {
    progressQuery = progressQuery.where("topicName", "==", topic);
  }

  const progressSnapshot = await progressQuery.limit(1).get();

  if (!progressSnapshot.empty) {
    const progress = progressSnapshot.docs[0].data();
    return progress.recommendedNextDifficulty || progress.currentDifficulty;
  }

  // No progress data - check recent quiz attempts
  const recentAttempts = await db
    .collection("study_buddy_quiz_attempts")
    .where("userId", "==", userId)
    .orderBy("startedAt", "desc")
    .limit(3)
    .get();

  if (!recentAttempts.empty) {
    const scores = recentAttempts.docs.map((doc) => doc.data().score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    return recommendStartingDifficulty({
      recentSessionScores: [avgScore],
    });
  }

  // Default to easy for new students
  return "easy";
}

/**
 * Get student's progress for specific subject/topic
 */
async function getStudentProgress(
  userId: string,
  subjectId: string,
  topic?: string
) {
  let query = db
    .collection("study_buddy_progress")
    .where("userId", "==", userId)
    .where("subjectId", "==", subjectId);

  if (topic) {
    query = query.where("topicName", "==", topic);
  }

  const snapshot = await query.limit(1).get();

  if (!snapshot.empty) {
    return snapshot.docs[0].data();
  }

  return null;
}

/**
 * Validate quiz answers and calculate score
 */
export function gradeQuiz(
  quiz: StudyBuddyQuiz,
  userAnswers: Array<{ questionId: string; answer: string | number }>
): {
  score: number;
  correctCount: number;
  totalQuestions: number;
  detailedResults: Array<{
    questionId: string;
    correct: boolean;
    explanation: string;
    userAnswer: string | number;
    correctAnswer: string | number;
  }>;
} {
  let correctCount = 0;
  const detailedResults: Array<any> = [];

  userAnswers.forEach((userAnswer) => {
    const question = quiz.questions.find(
      (q) => q.questionId === userAnswer.questionId
    );

    if (question) {
      const isCorrect = userAnswer.answer === question.correctAnswer;
      if (isCorrect) correctCount++;

      detailedResults.push({
        questionId: question.questionId,
        correct: isCorrect,
        explanation: question.explanation,
        userAnswer: userAnswer.answer,
        correctAnswer: question.correctAnswer,
      });
    }
  });

  const totalQuestions = quiz.questions.length;
  const score = Math.round((correctCount / totalQuestions) * 100);

  return {
    score,
    correctCount,
    totalQuestions,
    detailedResults,
  };
}
