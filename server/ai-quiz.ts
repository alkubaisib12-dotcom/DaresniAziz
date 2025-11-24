import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface QuizQuestion {
  question: string;
  type: "multiple_choice" | "true_false";
  options?: string[]; // For multiple choice (4 options)
  correctAnswer: string; // The correct answer text or "true"/"false"
  explanation: string; // Explanation of why this is correct
  topic: string; // Which topic/area this question covers
}

export interface SessionQuiz {
  questions: QuizQuestion[];
  focusAreas: string[]; // Main areas the quiz focuses on
  difficulty: "easy" | "medium" | "hard";
}

export interface GenerateQuizInput {
  aiSummary: {
    whatWasLearned: string;
    mistakes: string;
    strengths: string;
    practiceTasks: string;
  };
  subject?: string;
  studentName?: string;
}

/* -------------------------------------------------------------------------- */
/*                         Generate Quiz from Summary                         */
/* -------------------------------------------------------------------------- */

export async function generateSessionQuiz(
  input: GenerateQuizInput
): Promise<SessionQuiz> {
  const { aiSummary, subject, studentName } = input;

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
    throw new Error(
      "AI quiz feature is not configured. Please contact your administrator to set up the GEMINI_API_KEY."
    );
  }

  const prompt = `You are an educational assessment specialist creating a personalized quiz to help a student improve.

Based on the following lesson summary, create a quiz that:
1. Focuses primarily on the student's weak areas and mistakes
2. Tests understanding of what was learned
3. Reinforces the practice tasks

**Session Details:**
${subject ? `Subject: ${subject}` : ""}
${studentName ? `Student: ${studentName}` : ""}

**Lesson Summary:**

What Was Learned:
${aiSummary.whatWasLearned}

Mistakes & Areas for Improvement:
${aiSummary.mistakes}

Strengths:
${aiSummary.strengths}

Practice Tasks:
${aiSummary.practiceTasks}

**Instructions:**
Create a quiz with 8-10 questions that will help the student improve. The questions should:
- 60% focused on the mistakes/weak areas
- 30% on testing understanding of what was learned
- 10% on practice tasks
- Mix of multiple choice (4 options) and true/false questions
- Each question must include a detailed explanation of the correct answer
- Questions should be challenging but fair
- Focus on conceptual understanding, not memorization

Format your response as a JSON object with this structure:
{
  "questions": [
    {
      "question": "Question text here?",
      "type": "multiple_choice" or "true_false",
      "options": ["Option A", "Option B", "Option C", "Option D"], // Only for multiple_choice
      "correctAnswer": "The correct option text" or "true"/"false",
      "explanation": "Detailed explanation of why this is correct",
      "topic": "Brief topic name this question covers"
    }
  ],
  "focusAreas": ["Area 1", "Area 2", "Area 3"], // Main topics covered in quiz
  "difficulty": "medium" // or "easy" or "hard" based on the content
}

Ensure all questions are clear, educational, and directly related to the session content.`;

  // Try multiple model names in order of preference
  const modelNames = [
    "gemini-2.5-flash",  // Primary: fast and cost-efficient
    "gemini-2.0-flash",  // Fallback 1: alternative flash model
    "gemini-2.5-pro",    // Fallback 2: more capable but slower
  ];

  let model: any;
  let lastError: any;

  for (const modelName of modelNames) {
    try {
      model = genAI.getGenerativeModel({ model: modelName });
      break;
    } catch (e: any) {
      lastError = e;
      console.log(`Model ${modelName} not available, trying next...`);
      continue;
    }
  }

  if (!model) {
    throw new Error(
      `Unable to initialize any Gemini AI model. Last error: ${
        lastError?.message || "Unknown"
      }`
    );
  }

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();

    // Extract JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI Response (no JSON found):", responseText);
      throw new Error(
        "Could not parse JSON from AI response. The AI service may be unavailable."
      );
    }

    const quiz = JSON.parse(jsonMatch[0]) as SessionQuiz;

    // Validate structure
    if (!quiz.questions || !Array.isArray(quiz.questions) || quiz.questions.length === 0) {
      console.error("AI Response missing or invalid questions:", quiz);
      throw new Error("AI response missing required fields. Please try again.");
    }

    // Validate each question
    for (const q of quiz.questions) {
      if (!q.question || !q.type || !q.correctAnswer || !q.explanation || !q.topic) {
        console.error("Invalid question structure:", q);
        throw new Error("Invalid question format in AI response.");
      }
      if (q.type === "multiple_choice" && (!q.options || q.options.length !== 4)) {
        console.error("Multiple choice question missing 4 options:", q);
        throw new Error("Multiple choice questions must have exactly 4 options.");
      }
    }

    if (!quiz.focusAreas || !Array.isArray(quiz.focusAreas)) {
      quiz.focusAreas = ["General Review"];
    }

    if (!quiz.difficulty) {
      quiz.difficulty = "medium";
    }

    return quiz;
  } catch (error: any) {
    const msg = String(error?.message ?? error);

    if (msg.includes("API key")) {
      throw new Error(
        "Invalid or missing Google Gemini API key. Please contact support."
      );
    }

    if (msg.includes("quota")) {
      throw new Error("AI service quota exceeded. Please try again later.");
    }

    if (msg.includes("model is overloaded") || msg.includes("503")) {
      throw new Error(
        "AI service is temporarily overloaded. Please try again in a few seconds."
      );
    }

    throw new Error(
      error?.message || "Failed to generate quiz. Please try again."
    );
  }
}
