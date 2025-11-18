// Quick test to verify Gemini API is working
import { GoogleGenerativeAI } from "@google/generative-ai";
import 'dotenv/config';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testGemini() {
  try {
    console.log("🧪 Testing Gemini API...\n");

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const testNotes = `Student struggled with quadratic equations at first but made excellent progress.
    We covered the quadratic formula and completed 5 practice problems together.
    The student showed great improvement in factoring by the end of the session.`;

    const prompt = `Generate a JSON summary with these keys: "whatWasLearned", "mistakes", "strengths", "practiceTasks" based on: ${testNotes}`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    console.log("✅ Gemini API Response:");
    console.log(response);
    console.log("\n🎉 SUCCESS! Gemini is working correctly!");

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

testGemini();
