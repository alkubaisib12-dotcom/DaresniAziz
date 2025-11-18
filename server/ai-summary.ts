import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface LessonSummaryInput {
  tutorNotes: string;
  subject?: string;
  studentName?: string;
  duration?: number;
}

export interface LessonSummary {
  whatWasLearned: string;
  mistakes: string;
  strengths: string;
  practiceTasks: string;
}

/* -------------------------------------------------------------------------- */
/*                                Retry Helper                                */
/* -------------------------------------------------------------------------- */
// Handles temporary overload (503) and retries automatically
async function generateWithRetry(
  model: any,
  prompt: string,
  attempts = 3
): Promise<string> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text();
    } catch (err: any) {
      const msg = String(err?.message ?? err);

      const overloaded =
        msg.includes("The model is overloaded") ||
        msg.includes("503 Service Unavailable");

      if (!overloaded || i === attempts) {
        throw err;
      }

      // small backoff
      await new Promise((res) => setTimeout(res, 1000 * i));
    }
  }

  throw new Error("Failed after retries.");
}

/* -------------------------------------------------------------------------- */
/*                              Main Summary Logic                            */
/* -------------------------------------------------------------------------- */

export async function generateLessonSummary(
  input: LessonSummaryInput
): Promise<LessonSummary> {
  const { tutorNotes, subject, studentName, duration } = input;

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
    throw new Error(
      "AI summary feature is not configured. Please contact your administrator to set up the GEMINI_API_KEY."
    );
  }

  const prompt = `You are an educational assistant helping to create structured lesson summaries for students and their parents.

Based on the following tutor's notes from a tutoring session, generate a clear, professional summary with the following sections:

**Session Details:**
${subject ? `- Subject: ${subject}` : ""}
${studentName ? `- Student: ${studentName}` : ""}
${duration ? `- Duration: ${duration} minutes` : ""}

**Tutor's Notes:**
${tutorNotes}

Please generate a structured summary with exactly these four sections:

1. **What Was Learned**: Summarize the main topics, concepts, and skills covered in the session. Be specific about what was taught.
2. **Mistakes & Areas for Improvement**: Identify common mistakes the student made or areas where they struggled. Be constructive and specific.
3. **Strengths**: Highlight what the student did well, their achievements, and positive behaviors during the session.
4. **Practice Tasks**: Provide 3–5 specific, actionable tasks or exercises the student should work on before the next session.

Format your response as a JSON object with these exact keys: "whatWasLearned", "mistakes", "strengths", "practiceTasks". Each value should be a clear, well-formatted string.`;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
  });

  try {
    // 🔄 Auto-retry for 503 overload
    const responseText = await generateWithRetry(model, prompt);

    // Extract JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI Response (no JSON found):", responseText);
      throw new Error(
        "Could not parse JSON from AI response. The AI service may be unavailable."
      );
    }

    const summary = JSON.parse(jsonMatch[0]) as LessonSummary;

    // Validate final structure
    if (
      !summary.whatWasLearned ||
      !summary.mistakes ||
      !summary.strengths ||
      !summary.practiceTasks
    ) {
      console.error("AI Response missing fields:", summary);
      throw new Error(
        "AI response missing required fields. Please try again."
      );
    }

    return summary;
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
      error?.message || "Failed to generate AI summary. Please try again."
    );
  }
}
