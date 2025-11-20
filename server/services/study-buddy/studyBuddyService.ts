/**
 * Study Buddy Service - Main Orchestration Layer
 *
 * This is the core service that:
 * 1. Manages chat conversations with streaming responses
 * 2. Integrates student context for personalization
 * 3. Triggers tutor upsell logic
 * 4. Coordinates with other services (quiz, revision, etc.)
 */
import type { StudyBuddyProgress } from "../../../shared/studyBuddyTypes";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  ChatRequest,
  StudyBuddyMessage,
  StudyBuddyConversation,
  MessageRole,
  ChatStreamEvent,
} from "../../../shared/studyBuddyTypes";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../../firebase-admin";
import { buildStudentContext, formatContextForAI } from "./contextBuilder";
import {
  shouldSuggestTutor,
  generateTutorSuggestion,
  detectAcademicIntegrityRisk,
  getAcademicIntegrityResponse,
  isAskingAboutPricing,
  getPricingResponse,
  isComparingAIvsTutor,
  getAIvsTutorComparison,
} from "./tutorUpsell";
import { Response } from "express";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * Handle chat message with streaming response
 */
export async function handleChatMessage(
  request: ChatRequest,
  userId: string,
  res: Response
): Promise<void> {
  const { message, conversationId, includeContext = true } = request;

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // Check for academic integrity risks first
    if (detectAcademicIntegrityRisk(message)) {
      const response = getAcademicIntegrityResponse();
      sendStreamEvent(res, { type: "token", content: response });
      sendStreamEvent(res, { type: "complete" });

      // Save the exchange
      const convId = conversationId || (await createConversation(userId));
      await saveMessage(convId, userId, "user", message);
      await saveMessage(convId, userId, "assistant", response, {
        suggestedTutor: true,
      });

      res.end();
      return;
    }

    // Get or create conversation
    const convId = conversationId || (await createConversation(userId));

    // Save user message
    await saveMessage(convId, userId, "user", message);

    // Build student context for personalization
    let contextText = "";
    if (includeContext) {
      const context = await buildStudentContext(userId, {
        includeProgressData: true,
        includeQuizHistory: true,
        includeRecentSessions: true,
      });
      contextText = formatContextForAI(context);
    }

    // Get conversation history
    const history = await getConversationHistory(convId, 20);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(contextText);

    // Get Gemini model
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4000,
      },
    });

    // Build conversation for Gemini
    const conversationText = buildConversationForGemini(history, message, systemPrompt);

    // Stream response from Gemini
    let fullResponse = "";

    const result = await model.generateContentStream(conversationText);

    // Handle stream events
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullResponse += chunkText;
        sendStreamEvent(res, { type: "token", content: chunkText });
      }
    }

    // Save assistant message
    const assistantMessageId = await saveMessage(
      convId,
      userId,
      "assistant",
      fullResponse
    );

    // Check if we should suggest a tutor
    const updatedHistory = await getConversationHistory(convId, 30);
    const progress = await getRecentProgress(userId);

    const upsellDecision = shouldSuggestTutor({
      userMessage: message,
      progress: progress ?? undefined,
      conversationHistory: updatedHistory,
      conversationLength: updatedHistory.length,
    });

    if (upsellDecision.shouldUpsell) {
      // Get subject ID from progress or conversation
      const subjectId = progress?.subjectId;

      const suggestion = await generateTutorSuggestion(
        upsellDecision,
        subjectId
      );

      // Fetch recommended tutors if subject is known
      if (subjectId) {
        suggestion.recommendedTutors = await getRecommendedTutors(
          subjectId,
          3
        );
      }

      sendStreamEvent(res, { type: "upsell", suggestion });

      // Update message metadata to indicate tutor was suggested
      await updateMessageMetadata(assistantMessageId, {
        suggestedTutor: true,
      });
    }

    // Send completion event
    sendStreamEvent(res, {
      type: "complete",
      messageId: assistantMessageId,
      conversationId: convId,
    });

    res.end();
  } catch (error) {
    console.error("Error in handleChatMessage:", error);
    sendStreamEvent(res, {
      type: "error",
      error: "An unexpected error occurred",
    });
    res.end();
  }
}

/**
 * Build system prompt with student context
 */
function buildSystemPrompt(contextText: string): string {
  return `You are an AI Study Buddy - a friendly, efficient academic assistant for university students.

**Your Role:**
- Help students with ANY subject (Math, English, Science, History, Languages, etc.)
- Generate quizzes and study plans for any topic
- Explain concepts clearly and concisely
- Help with grammar, spelling, and writing (especially for English)
- Encourage learning and practice

**Response Style - VERY IMPORTANT:**
- Keep responses SHORT (2-3 sentences max for simple questions)
- Be friendly but efficient
- Get straight to the point
- Use bullet points for clarity
- Only provide long explanations if specifically requested

**Academic Integrity:**
- Never complete assignments or homework for students
- Guide learning, don't provide direct answers
- If someone asks you to do their work, politely decline

**Student Context:**
${contextText || "New student - no history yet."}

**Examples of Good Responses:**
- "I can help with that! [Quick explanation in 2-3 sentences]"
- "Let me break this down: [bullet point list]"
- "For spelling: [correct spelling] is the right way. Remember [tip]."

Be helpful, concise, and ready to assist with any academic subject.`;
}

/**
 * Build conversation text for Gemini API
 */
function buildConversationForGemini(
  history: StudyBuddyMessage[],
  currentMessage: string,
  systemPrompt: string
): string {
  let conversationText = systemPrompt + "\n\n---\n\n";

  // Add conversation history (limit to recent messages to stay within context)
  history.slice(-10).forEach((msg) => {
    if (msg.role !== "system") {
      const role = msg.role === "assistant" ? "Assistant" : "Student";
      conversationText += `${role}: ${msg.content}\n\n`;
    }
  });

  // Add current message
  conversationText += `Student: ${currentMessage}\n\nAssistant:`;

  return conversationText;
}

/**
 * Send SSE event to client
 */
function sendStreamEvent(res: Response, event: ChatStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Create a new conversation
 */
async function createConversation(userId: string): Promise<string> {
  const conversationId = db
    .collection("study_buddy_conversations")
    .doc().id;

  const conversation: StudyBuddyConversation = {
    conversationId,
    userId,
    title: "New Conversation",
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    messageCount: 0,
    lastMessage: "",
    lastMessageAt: Timestamp.now(),
  };

  await db
    .collection("study_buddy_conversations")
    .doc(conversationId)
    .set(conversation);

  return conversationId;
}

/**
 * Save a message to Firestore
 */
async function saveMessage(
  conversationId: string,
  userId: string,
  role: MessageRole,
  content: string,
  metadata?: StudyBuddyMessage["metadata"]
): Promise<string> {
  const messageId = db.collection("study_buddy_messages").doc().id;

  const message: any = {
    messageId,
    conversationId,
    userId,
    role,
    content,
    timestamp: Timestamp.now(),
  };

  // Only add metadata if it's defined (Firestore doesn't accept undefined)
  if (metadata) {
    message.metadata = metadata;
  }

  await db.collection("study_buddy_messages").doc(messageId).set(message);

  // Update conversation
  const conversationRef = db
    .collection("study_buddy_conversations")
    .doc(conversationId);
  const conversationDoc = await conversationRef.get();

  if (conversationDoc.exists) {
    const conversation = conversationDoc.data() as StudyBuddyConversation;

    // Auto-generate title from first user message
    let title = conversation.title;
    if (
      title === "New Conversation" &&
      role === "user" &&
      conversation.messageCount === 0
    ) {
      title = content.substring(0, 50) + (content.length > 50 ? "..." : "");
    }

    await conversationRef.update({
      messageCount: conversation.messageCount + 1,
      lastMessage: content.substring(0, 200),
      lastMessageAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      title,
    });
  }

  return messageId;
}

/**
 * Update message metadata
 */
async function updateMessageMetadata(
  messageId: string,
  metadata: StudyBuddyMessage["metadata"]
): Promise<void> {
  await db
    .collection("study_buddy_messages")
    .doc(messageId)
    .update({ metadata });
}

/**
 * Get conversation history
 */
async function getConversationHistory(
  conversationId: string,
  limit: number = 50
): Promise<StudyBuddyMessage[]> {
  const messagesSnapshot = await db
    .collection("study_buddy_messages")
    .where("conversationId", "==", conversationId)
    .orderBy("timestamp", "asc")
    .limit(limit)
    .get();

  return messagesSnapshot.docs.map((doc) => doc.data() as StudyBuddyMessage);
}

/**
 * Get recent progress for tutor upsell logic
 */
async function getRecentProgress(
  userId: string
): Promise<StudyBuddyProgress | null> {
  const progressSnapshot = await db
    .collection("study_buddy_progress")
    .where("userId", "==", userId)
    .orderBy("updatedAt", "desc")
    .limit(1)
    .get();

  if (progressSnapshot.empty) return null;

  return progressSnapshot.docs[0].data() as StudyBuddyProgress;
}

/**
 * Get recommended tutors for a subject
 */
async function getRecommendedTutors(
  subjectId: string,
  limit: number = 3
): Promise<any[]> {
  // Fetch subject to get its name
  const subjectDoc = await db.collection("subjects").doc(subjectId).get();
  const subjectName = subjectDoc.data()?.name || "";

  // Find tutor profiles that teach this subject
  const tutorsSnapshot = await db
    .collection("tutor_profiles")
    .where("subjectIds", "array-contains", subjectId)
    .where("verificationStatus", "==", "approved")
    .limit(limit * 2) // Fetch more to filter
    .get();

  // Get user details for each tutor
  const tutors: any[] = [];

  for (const tutorDoc of tutorsSnapshot.docs) {
    const tutorProfile = tutorDoc.data();

    // Fetch user details
    const userDoc = await db
      .collection("users")
      .doc(tutorProfile.tutorId)
      .get();
    const userData = userDoc.data();

    if (userData) {
      // Calculate average rating
      const reviewsSnapshot = await db
        .collection("reviews")
        .where("tutorId", "==", tutorProfile.tutorId)
        .get();

      let avgRating = 0;
      if (!reviewsSnapshot.empty) {
        const ratings = reviewsSnapshot.docs.map(
          (doc) => doc.data().rating || 0
        );
        avgRating =
          ratings.reduce((a, b) => a + b, 0) / ratings.length;
      }

      tutors.push({
        tutorId: tutorProfile.tutorId,
        name: `${userData.firstName || ""} ${userData.lastName || ""}`.trim(),
        rating: Number(avgRating.toFixed(1)),
        specialization: subjectName,
        pricePerHour: tutorProfile.hourlyRate || 0,
        availability: "available", // Simplified - could check actual availability
      });
    }

    if (tutors.length >= limit) break;
  }

  // Sort by rating
  tutors.sort((a, b) => b.rating - a.rating);

  return tutors.slice(0, limit);
}

/**
 * Get all conversations for a user
 */
export async function getUserConversations(
  userId: string
): Promise<StudyBuddyConversation[]> {
  const conversationsSnapshot = await db
    .collection("study_buddy_conversations")
    .where("userId", "==", userId)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .get();

  return conversationsSnapshot.docs.map(
    (doc) => doc.data() as StudyBuddyConversation
  );
}

/**
 * Delete a conversation
 */
export async function deleteConversation(
  conversationId: string,
  userId: string
): Promise<void> {
  // Verify ownership
  const conversationDoc = await db
    .collection("study_buddy_conversations")
    .doc(conversationId)
    .get();

  if (!conversationDoc.exists) {
    throw new Error("Conversation not found");
  }

  const conversation = conversationDoc.data() as StudyBuddyConversation;
  if (conversation.userId !== userId) {
    throw new Error("Unauthorized");
  }

  // Delete all messages
  const messagesSnapshot = await db
    .collection("study_buddy_messages")
    .where("conversationId", "==", conversationId)
    .get();

  const batch = db.batch();
  messagesSnapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  // Delete conversation
  batch.delete(
    db.collection("study_buddy_conversations").doc(conversationId)
  );

  await batch.commit();
}
