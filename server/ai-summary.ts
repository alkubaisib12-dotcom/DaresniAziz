import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Google Gemini (Free tier available!)
// Get your free API key from: https://makersuite.google.com/app/apikey
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

export async function generateLessonSummary(
  input: LessonSummaryInput
): Promise<LessonSummary> {
  const { tutorNotes, subject, studentName, duration } = input;

  // Check if API key is configured
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === "") {
    throw new Error("AI summary feature is not configured. Please contact your administrator to set up the GEMINI_API_KEY.");
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

4. **Practice Tasks**: Provide 3-5 specific, actionable tasks or exercises the student should work on before the next session.

Format your response as a JSON object with these exact keys: "whatWasLearned", "mistakes", "strengths", "practiceTasks". Each value should be a clear, well-formatted string (you can use markdown formatting like bullet points).`;

  // Use Gemini 1.5 Flash (free tier)
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();

    // Try to extract JSON from the response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI Response (no JSON found):", responseText);
      throw new Error("Could not parse JSON from AI response. The AI service may be unavailable.");
    }

    const summary = JSON.parse(jsonMatch[0]) as LessonSummary;

    // Validate that all required fields are present
    if (
      !summary.whatWasLearned ||
      !summary.mistakes ||
      !summary.strengths ||
      !summary.practiceTasks
    ) {
      console.error("AI Response missing fields:", summary);
      throw new Error("AI response missing required fields. Please try again.");
    }

    return summary;
  } catch (error: any) {
    // Handle specific Gemini API errors
    if (error?.message?.includes("API key")) {
      throw new Error("Invalid or missing Google Gemini API key. Please contact support.");
    }
    if (error?.message?.includes("quota")) {
      throw new Error("AI service quota exceeded. Please try again later.");
    }
    // Re-throw with more context
    throw new Error(error?.message || "Failed to generate AI summary. Please try again.");
  }
}
