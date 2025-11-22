/**
 * Tutor Upsell Logic
 *
 * This service implements business rules for suggesting human tutor sessions.
 * Critical for ensuring the AI Study Buddy complements (not replaces) paid tutoring.
 *
 * Business Goals:
 * 1. Provide value through AI assistance
 * 2. Identify situations where human tutors are more appropriate
 * 3. Convert AI users to paid tutor bookings strategically
 * 4. Maintain academic integrity (no assignment completion)
 */

import {
  UpsellDecision,
  UpsellContext,
  TutorUpsellSuggestion,
  UpsellPriority,
  StudyBuddyProgress,
  StudyBuddyQuizAttempt,
  UPSELL_TRIGGERS,
} from "../../../shared/studyBuddyTypes";
import { calculateMasteryScore } from "./adaptiveDifficulty";

// ============================================================================
// MAIN UPSELL DECISION LOGIC
// ============================================================================

/**
 * Determine if and how to suggest a tutor to the student
 */
export function shouldSuggestTutor(context: UpsellContext): UpsellDecision {
  const { userMessage, progress, recentAttempts, conversationHistory } =
    context;

  // Check each trigger rule in priority order
  const checks = [
    checkAssignmentHelp(userMessage),
    checkRepeatedFailure(progress),
    checkLowMasteryPlateau(progress),
    checkComplexTopicRequest(userMessage),
    checkLongConversationWithoutProgress(context),
    checkExplicitTutorRequest(userMessage),
  ];

  // Return the first triggered rule
  for (const decision of checks) {
    if (decision.shouldUpsell) {
      return decision;
    }
  }

  // No upsell needed
  return {
    shouldUpsell: false,
    priority: "low",
    reason: "",
    triggerType: "none",
  };
}

/**
 * Generate a complete tutor suggestion with message and recommendations
 */
export async function generateTutorSuggestion(
  decision: UpsellDecision,
  subjectId?: string
): Promise<TutorUpsellSuggestion> {
  if (!decision.shouldUpsell) {
    throw new Error("Cannot generate suggestion when shouldUpsell is false");
  }

  // Get message template based on trigger type
  const message = getUpsellMessage(decision.triggerType, decision.reason);

  // Get CTA buttons based on priority
  const ctaButtons = getUpsellCTAButtons(decision.priority);

  return {
    priority: decision.priority,
    message,
    reason: decision.reason,
    ctaButtons,
    // recommendedTutors will be populated by the API route
    // by querying tutor_profiles filtered by subjectId
  };
}

// ============================================================================
// INDIVIDUAL UPSELL CHECK RULES
// ============================================================================

/**
 * RULE 1: Student asks for assignment/homework completion
 * Priority: HIGH
 * This maintains academic integrity
 */
function checkAssignmentHelp(userMessage: string): UpsellDecision {
  const lowerMessage = userMessage.toLowerCase();

  const hasAssignmentKeyword = UPSELL_TRIGGERS.ASSIGNMENT_KEYWORDS.some((kw) =>
    lowerMessage.includes(kw)
  );

  if (hasAssignmentKeyword) {
    return {
      shouldUpsell: true,
      priority: "high",
      reason:
        "I can't complete assignments for you, but I can help you understand the concepts! A tutor can guide you through problem-solving while maintaining academic integrity.",
      triggerType: "assignment_help",
    };
  }

  return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
}

/**
 * RULE 2: Repeated failures (3+ consecutive incorrect quizzes)
 * Priority: HIGH
 * Student clearly needs personalized help
 */
function checkRepeatedFailure(
  progress?: StudyBuddyProgress
): UpsellDecision {
  if (!progress) {
    return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
  }

  if (progress.consecutiveIncorrect >= 3) {
    return {
      shouldUpsell: true,
      priority: "high",
      reason: `You've struggled with ${progress.consecutiveIncorrect} consecutive quizzes. A tutor can provide personalized guidance to help you understand these concepts better.`,
      triggerType: "repeated_failure",
      suggestedTutorSpecialization: progress.subjectId,
    };
  }

  return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
}

/**
 * RULE 3: Low mastery score after many attempts (plateau effect)
 * Priority: MEDIUM
 * Student is stuck and needs different teaching approach
 */
function checkLowMasteryPlateau(
  progress?: StudyBuddyProgress
): UpsellDecision {
  if (!progress) {
    return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
  }

  const masteryScore = calculateMasteryScore(progress);

  if (masteryScore < 40 && progress.totalAttempts >= 5) {
    return {
      shouldUpsell: true,
      priority: "medium",
      reason: `After ${progress.totalAttempts} attempts, your mastery is still at ${masteryScore}%. A tutor can help you break through this learning plateau with personalized strategies.`,
      triggerType: "low_mastery",
      suggestedTutorSpecialization: progress.subjectId,
    };
  }

  // Also check for moderate mastery but many attempts (possible optimization)
  if (masteryScore >= 40 && masteryScore < 60 && progress.totalAttempts >= 10) {
    return {
      shouldUpsell: true,
      priority: "low",
      reason: `You've been working hard! A tutor could help you master this topic faster and more efficiently.`,
      triggerType: "low_mastery",
      suggestedTutorSpecialization: progress.subjectId,
    };
  }

  return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
}

/**
 * RULE 4: Complex or advanced topic request
 * Priority: MEDIUM
 * Some topics benefit more from human instruction
 */
function checkComplexTopicRequest(userMessage: string): UpsellDecision {
  const lowerMessage = userMessage.toLowerCase();

  const hasComplexKeyword = UPSELL_TRIGGERS.COMPLEX_KEYWORDS.some((kw) =>
    lowerMessage.includes(kw)
  );

  if (hasComplexKeyword) {
    return {
      shouldUpsell: true,
      priority: "medium",
      reason:
        "This is an advanced topic! While I can provide general guidance, a specialized tutor can offer deeper insights, real-world examples, and personalized strategies.",
      triggerType: "complex_topic",
    };
  }

  // Check for topic complexity indicators
  const complexTopicPatterns = [
    /thesis/i,
    /dissertation/i,
    /research methodology/i,
    /advanced.*algorithm/i,
    /machine learning/i,
    /quantum/i,
    /graduate level/i,
  ];

  if (complexTopicPatterns.some((pattern) => pattern.test(userMessage))) {
    return {
      shouldUpsell: true,
      priority: "medium",
      reason:
        "This topic requires advanced expertise. A tutor with specialized knowledge can provide the depth you need.",
      triggerType: "complex_topic",
    };
  }

  return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
}

/**
 * RULE 5: Long conversation without meaningful progress
 * Priority: LOW
 * Student might benefit from live instruction
 */
function checkLongConversationWithoutProgress(
  context: UpsellContext
): UpsellDecision {
  const { conversationLength, progress } = context;

  if (conversationLength >= 15) {
    // Long conversation detected

    // Check if there's progress data showing lack of improvement
    if (progress) {
      const masteryScore = calculateMasteryScore(progress);

      if (masteryScore < 50) {
        return {
          shouldUpsell: true,
          priority: "low",
          reason:
            "We've had a great conversation, but sometimes a different teaching approach can help. Would you like to try working with a tutor for a more interactive learning experience?",
          triggerType: "long_conversation",
          suggestedTutorSpecialization: progress.subjectId,
        };
      }
    }

    // Long conversation without progress data
    if (!progress) {
      return {
        shouldUpsell: true,
        priority: "low",
        reason:
          "We've covered a lot together! If you'd like more interactive practice and immediate feedback, consider booking a session with one of our tutors.",
        triggerType: "long_conversation",
      };
    }
  }

  return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
}

/**
 * RULE 6: Student explicitly asks for tutor recommendation
 * Priority: MEDIUM
 * Direct request should be honored
 */
function checkExplicitTutorRequest(userMessage: string): UpsellDecision {
  const lowerMessage = userMessage.toLowerCase();

  const tutorRequestPatterns = [
    /recommend.*tutor/i,
    /find.*tutor/i,
    /need.*tutor/i,
    /book.*tutor/i,
    /get.*tutor/i,
    /tutor.*help/i,
    /human.*help/i,
    /real.*teacher/i,
  ];

  if (tutorRequestPatterns.some((pattern) => pattern.test(userMessage))) {
    return {
      shouldUpsell: true,
      priority: "medium",
      reason:
        "Great idea! Our tutors are experienced educators who can provide personalized, one-on-one instruction.",
      triggerType: "user_request",
    };
  }

  return { shouldUpsell: false, priority: "low", reason: "", triggerType: "none" };
}

// ============================================================================
// MESSAGE TEMPLATES
// ============================================================================

/**
 * Get appropriate upsell message based on trigger type
 */
function getUpsellMessage(
  triggerType: UpsellDecision["triggerType"],
  customReason?: string
): string {
  const templates: Record<UpsellDecision["triggerType"], string> = {
    assignment_help: `### 📚 Let's Focus on Learning

I'm designed to help you **understand** concepts, not complete assignments. Here's what I can do:
- Explain the underlying concepts
- Provide practice problems with solutions
- Guide you through similar examples

**For assignment guidance**, our tutors can walk you through the problem-solving process while ensuring you learn and maintain academic integrity.`,

    repeated_failure: `### 💡 Time for Extra Support

${customReason || "You've been working hard, but hitting some challenges."}

Our tutors specialize in breaking down difficult concepts and providing personalized strategies that work for **your** learning style.`,

    low_mastery: `### 🎯 Accelerate Your Progress

${customReason || "You've put in the effort, and that's commendable!"}

A tutor can help you:
- Identify and fix specific gaps in understanding
- Provide tailored practice
- Offer techniques that match your learning style`,

    complex_topic: `### 🚀 Advanced Topic Alert

${customReason || "This is a challenging topic that benefits from expert guidance."}

Our specialized tutors have deep expertise and can provide:
- Real-world context and applications
- Advanced problem-solving strategies
- Personalized mentorship`,

    long_conversation: `### 🤝 Ready for Live Interaction?

${customReason || "We've had a productive conversation!"}

Sometimes the best learning happens in real-time with a human tutor who can:
- Answer questions immediately
- Adjust teaching style on the fly
- Provide hands-on guidance`,

    user_request: `### 👨‍🏫 Find Your Perfect Tutor

${customReason || "I'd be happy to help you find a tutor!"}

Our platform has expert tutors with proven track records. Let me show you some highly-rated options.`,

    none: "",
  };

  return templates[triggerType];
}

/**
 * Get CTA buttons based on priority
 */
function getUpsellCTAButtons(
  priority: UpsellPriority
): TutorUpsellSuggestion["ctaButtons"] {
  switch (priority) {
    case "high":
      return [
        {
          label: "View Recommended Tutors",
          action: "view_tutors",
        },
        {
          label: "Continue with AI",
          action: "dismiss",
        },
      ];

    case "medium":
      return [
        {
          label: "Browse Tutors",
          action: "view_tutors",
        },
        {
          label: "Maybe Later",
          action: "dismiss",
        },
      ];

    case "low":
      return [
        {
          label: "Explore Tutors",
          action: "view_tutors",
        },
        {
          label: "No Thanks",
          action: "dismiss",
        },
      ];
  }
}

// ============================================================================
// CONTEXTUAL HELPERS
// ============================================================================

/**
 * Check if user is asking about pricing
 */
export function isAskingAboutPricing(message: string): boolean {
  const pricingKeywords = [
    "how much",
    "cost",
    "price",
    "expensive",
    "cheap",
    "afford",
    "rate",
    "fee",
  ];

  const lowerMessage = message.toLowerCase();
  return pricingKeywords.some((kw) => lowerMessage.includes(kw));
}

/**
 * Check if user is comparing AI vs tutor
 */
export function isComparingAIvsTutor(message: string): boolean {
  const comparisonPatterns = [
    /ai.*(?:vs|versus|compared to).*tutor/i,
    /tutor.*(?:vs|versus|compared to).*ai/i,
    /difference.*between.*ai.*tutor/i,
    /should i.*tutor.*or.*ai/i,
    /why.*tutor.*instead.*ai/i,
  ];

  return comparisonPatterns.some((pattern) => pattern.test(message));
}

/**
 * Get response for pricing questions
 */
export function getPricingResponse(): string {
  return `### 💰 Tutor Pricing

Our tutors set their own rates based on their expertise and specialization. Typical rates are:
- **Undergraduate subjects**: $15-30 per hour
- **Advanced/Graduate topics**: $30-50 per hour
- **Specialized expertise**: $50+ per hour

**Free AI Study Buddy** (me!) is included with your account and available 24/7 for:
- Practice quizzes
- Concept explanations
- Study planning
- Quick questions

**Human Tutors** are best for:
- Personalized instruction
- Complex topics
- Assignment guidance
- Deep dives

Would you like to see tutors in your subject area?`;
}

/**
 * Get response comparing AI vs human tutors
 */
export function getAIvsTutorComparison(): string {
  return `### 🤖 AI Study Buddy vs 👨‍🏫 Human Tutors

**I'm your AI Study Buddy - Here's what I'm great at:**
✅ Available 24/7
✅ Instant responses
✅ Unlimited practice quizzes
✅ Personalized to your progress
✅ Free with your account
✅ Great for review and practice

**Human Tutors Excel At:**
⭐ Real-time interaction and discussion
⭐ Explaining complex concepts in multiple ways
⭐ Providing context and real-world examples
⭐ Adapting to your facial expressions and confusion
⭐ Mentorship and motivation
⭐ Assignment guidance (within academic integrity)

**My Recommendation:**
Use **both**! I'm perfect for daily practice and quick questions. Book a tutor when you need deep understanding, are stuck on challenging topics, or want personalized strategies.

Think of me as your study partner, and tutors as your mentors! 🚀`;
}

// ============================================================================
// ANTI-PATTERNS & SAFETY
// ============================================================================

/**
 * Detect if user is trying to bypass academic integrity
 */
export function detectAcademicIntegrityRisk(message: string): boolean {
  const riskyPatterns = [
    /solve.*for me/i,
    /do my.*(?:homework|assignment|project)/i,
    /give me.*answer/i,
    /complete.*(?:homework|assignment)/i,
    /write.*(?:essay|paper|report).*for me/i,
    /just tell me.*answer/i,
    /plagiarism/i,
    /cheat/i,
  ];

  return riskyPatterns.some((pattern) => pattern.test(message));
}

/**
 * Get academic integrity response
 */
export function getAcademicIntegrityResponse(): string {
  return `### 📖 Academic Integrity

I'm designed to help you **learn**, not complete work for you. Here's how I can help ethically:

**What I CAN Do:**
✅ Explain concepts and theories
✅ Provide practice problems with explanations
✅ Guide you through problem-solving steps
✅ Help you understand course material
✅ Review your work and suggest improvements

**What I WON'T Do:**
❌ Complete assignments for you
❌ Write essays or papers
❌ Provide direct answers without explanation
❌ Help with anything that violates academic honesty

**Better Approach:**
Let me help you understand the concepts, then you'll be able to solve the problems yourself. That's true learning!

If you need help with an assignment, our tutors can guide you through the process while ensuring you do your own work.

How can I help you understand the concepts better?`;
}

// ============================================================================
// UPSELL ANALYTICS
// ============================================================================

/**
 * Track upsell effectiveness (for future analytics)
 */
export interface UpsellEvent {
  eventId: string;
  userId: string;
  conversationId: string;
  triggerType: UpsellDecision["triggerType"];
  priority: UpsellPriority;
  timestamp: Date;
  userAction: "viewed" | "clicked_view_tutors" | "dismissed" | "booked_tutor";
  tutorId?: string;
}

/**
 * Calculate upsell conversion rate (placeholder for analytics)
 */
export function calculateUpsellConversionRate(
  events: UpsellEvent[]
): {
  viewRate: number;
  clickRate: number;
  bookingRate: number;
  topTrigger: UpsellDecision["triggerType"];
} {
  const totalViewed = events.filter((e) => e.userAction === "viewed").length;
  const totalClicked = events.filter((e) =>
    e.userAction.includes("clicked")
  ).length;
  const totalBooked = events.filter(
    (e) => e.userAction === "booked_tutor"
  ).length;

  // Find most effective trigger
  const triggerCounts = events.reduce(
    (acc, event) => {
      if (event.userAction === "booked_tutor") {
        acc[event.triggerType] = (acc[event.triggerType] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  const topTrigger = (Object.keys(triggerCounts).reduce((a, b) =>
    triggerCounts[a] > triggerCounts[b] ? a : b
  ) || "none") as UpsellDecision["triggerType"];

  return {
    viewRate: totalViewed / events.length,
    clickRate: totalClicked / totalViewed || 0,
    bookingRate: totalBooked / totalClicked || 0,
    topTrigger,
  };
}
