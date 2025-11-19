/**
 * Revision Plan Generator
 *
 * Creates personalized study/revision plans based on:
 * - Exam date
 * - Student's weak areas and strengths
 * - Available study time per day
 * - Current knowledge level
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  StudyBuddyRevisionPlan,
  DailyTask,
  RevisionPlanRequest,
  RevisionPlanResponse,
  DEFAULT_VALUES,
} from "../../../shared/studyBuddyTypes";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../../firebase-admin";
import { buildStudentContext, formatContextForAI } from "./contextBuilder";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

/**
 * Generate a personalized revision plan
 */
export async function generateRevisionPlan(
  request: RevisionPlanRequest,
  userId: string
): Promise<RevisionPlanResponse> {
  const {
    subjectId,
    examDate,
    currentKnowledgeLevel = "intermediate",
    dailyStudyHours = DEFAULT_VALUES.DAILY_STUDY_HOURS,
    conversationId,
  } = request;

  // Parse exam date
  const examDateTime = new Date(examDate);
  const today = new Date();
  const daysUntilExam = Math.ceil(
    (examDateTime.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilExam < 1) {
    throw new Error("Exam date must be in the future");
  }

  // Fetch subject details
  const subjectDoc = await db.collection("subjects").doc(subjectId).get();
  const subjectData = subjectDoc.data();
  const subjectName = subjectData?.name || "Unknown Subject";

  // Get student context for personalization
  const studentContext = await buildStudentContext(userId, {
    includeProgressData: true,
    includeQuizHistory: true,
    includeRecentSessions: true,
  });

  // Find progress for this specific subject
  const subjectProgress = studentContext.progressBySubject.find(
    (p) => p.subjectId === subjectId
  );

  // Generate plan using Claude
  const dailyTasks = await generatePlanWithClaude({
    subjectName,
    daysUntilExam,
    dailyStudyHours,
    currentKnowledgeLevel,
    weakAreas: subjectProgress?.weakAreas || [],
    strengths: subjectProgress?.strengths || [],
    studentContext,
  });

  // Calculate total estimated hours
  const totalEstimatedHours = dailyTasks.reduce(
    (sum, day) =>
      sum +
      day.tasks.reduce((daySum, task) => daySum + task.estimatedMinutes, 0) /
        60,
    0
  );

  // Create revision plan document
  const planId = db.collection("study_buddy_revision_plans").doc().id;
  const plan: StudyBuddyRevisionPlan = {
    planId,
    userId,
    conversationId,
    subjectId,
    subjectName,
    examDate: Timestamp.fromDate(examDateTime),
    createdAt: Timestamp.now(),
    dailyTasks,
    focusAreas: subjectProgress?.weakAreas || [],
    totalEstimatedHours,
    dailyStudyHours,
    completionPercentage: 0,
    lastUpdated: Timestamp.now(),
  };

  await db.collection("study_buddy_revision_plans").doc(planId).set(plan);

  return {
    planId,
    dailyTasks,
    totalEstimatedHours,
    focusAreas: subjectProgress?.weakAreas || [],
    subjectName,
    daysUntilExam,
  };
}

/**
 * Generate revision plan using Claude AI
 */
async function generatePlanWithClaude(params: {
  subjectName: string;
  daysUntilExam: number;
  dailyStudyHours: number;
  currentKnowledgeLevel: string;
  weakAreas: string[];
  strengths: string[];
  studentContext: any;
}): Promise<StudyBuddyRevisionPlan["dailyTasks"]> {
  const {
    subjectName,
    daysUntilExam,
    dailyStudyHours,
    currentKnowledgeLevel,
    weakAreas,
    strengths,
  } = params;

  const prompt = `You are an expert study planner creating a personalized revision plan for a university student.

**Subject**: ${subjectName}
**Days Until Exam**: ${daysUntilExam} days
**Available Study Time**: ${dailyStudyHours} hours per day
**Current Knowledge Level**: ${currentKnowledgeLevel}

**Student's Weak Areas**: ${weakAreas.length > 0 ? weakAreas.join(", ") : "None identified"}
**Student's Strengths**: ${strengths.length > 0 ? strengths.join(", ") : "None identified"}

Create a day-by-day revision plan that:
1. Prioritizes weak areas early in the schedule
2. Includes regular review of strong areas to maintain them
3. Balances theory study with practice problems
4. Increases practice and mock exams closer to exam date
5. Includes breaks and lighter days to prevent burnout
6. Fits within the daily time budget (${dailyStudyHours} hours/day)

**IMPORTANT**: Respond ONLY with valid JSON in this exact format:
{
  "dailyPlan": [
    {
      "date": "YYYY-MM-DD",
      "tasks": [
        {
          "title": "Task title",
          "description": "Detailed description of what to study/practice",
          "estimatedMinutes": 60,
          "topic": "Topic name",
          "difficulty": "easy" | "medium" | "hard"
        }
      ]
    }
  ]
}

Generate a plan for all ${daysUntilExam} days.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8000,
      temperature: 0.7,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    // Extract JSON from response
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?$/g, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```\n?/g, "").replace(/```\n?$/g, "");
    }

    const parsed = JSON.parse(jsonText);

    // Transform to our format
    const dailyTasks: StudyBuddyRevisionPlan["dailyTasks"] = parsed.dailyPlan.map(
      (day: any) => ({
        date: day.date,
        tasks: day.tasks.map((task: any, index: number) => ({
          taskId: `task_${Date.now()}_${index}`,
          title: task.title,
          description: task.description,
          estimatedMinutes: task.estimatedMinutes || 60,
          topic: task.topic || subjectName,
          difficulty: task.difficulty || "medium",
          completed: false,
        })),
      })
    );

    return dailyTasks;
  } catch (error) {
    console.error("Error generating revision plan with Claude:", error);

    // Fallback: generate simple plan
    return generateFallbackPlan(
      subjectName,
      daysUntilExam,
      dailyStudyHours,
      weakAreas
    );
  }
}

/**
 * Fallback plan generator if Claude API fails
 */
function generateFallbackPlan(
  subjectName: string,
  daysUntilExam: number,
  dailyStudyHours: number,
  weakAreas: string[]
): StudyBuddyRevisionPlan["dailyTasks"] {
  const dailyTasks: StudyBuddyRevisionPlan["dailyTasks"] = [];
  const today = new Date();

  const minutesPerDay = dailyStudyHours * 60;

  for (let i = 0; i < daysUntilExam; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dateString = date.toISOString().split("T")[0];

    const tasks: DailyTask[] = [];

    // First third: Focus on weak areas
    if (i < daysUntilExam / 3) {
      tasks.push({
        taskId: `task_${Date.now()}_${i}_1`,
        title: `Review ${weakAreas[0] || subjectName} fundamentals`,
        description: `Study the core concepts and work through basic examples.`,
        estimatedMinutes: minutesPerDay / 2,
        topic: weakAreas[0] || subjectName,
        difficulty: "easy",
        completed: false,
      });

      tasks.push({
        taskId: `task_${Date.now()}_${i}_2`,
        title: `Practice ${weakAreas[0] || subjectName} problems`,
        description: `Complete practice exercises to reinforce understanding.`,
        estimatedMinutes: minutesPerDay / 2,
        topic: weakAreas[0] || subjectName,
        difficulty: "medium",
        completed: false,
      });
    }
    // Second third: Mixed practice
    else if (i < (daysUntilExam * 2) / 3) {
      tasks.push({
        taskId: `task_${Date.now()}_${i}_1`,
        title: `${subjectName} comprehensive review`,
        description: `Review all topics covered in the course.`,
        estimatedMinutes: minutesPerDay / 2,
        topic: subjectName,
        difficulty: "medium",
        completed: false,
      });

      tasks.push({
        taskId: `task_${Date.now()}_${i}_2`,
        title: `Practice challenging problems`,
        description: `Work on harder problems to test understanding.`,
        estimatedMinutes: minutesPerDay / 2,
        topic: subjectName,
        difficulty: "hard",
        completed: false,
      });
    }
    // Final third: Intensive practice
    else {
      tasks.push({
        taskId: `task_${Date.now()}_${i}_1`,
        title: `Mock exam practice`,
        description: `Complete a full mock exam under timed conditions.`,
        estimatedMinutes: minutesPerDay,
        topic: subjectName,
        difficulty: "hard",
        completed: false,
      });
    }

    dailyTasks.push({
      date: dateString,
      tasks,
    });
  }

  return dailyTasks;
}

/**
 * Mark a task as completed
 */
export async function markTaskCompleted(
  planId: string,
  taskId: string,
  userId: string
): Promise<void> {
  const planDoc = await db
    .collection("study_buddy_revision_plans")
    .doc(planId)
    .get();

  if (!planDoc.exists) {
    throw new Error("Revision plan not found");
  }

  const plan = planDoc.data() as StudyBuddyRevisionPlan;

  // Verify ownership
  if (plan.userId !== userId) {
    throw new Error("Unauthorized");
  }

  // Find and update the task
  let taskFound = false;
  plan.dailyTasks.forEach((day) => {
    day.tasks.forEach((task) => {
      if (task.taskId === taskId) {
        task.completed = true;
        task.completedAt = Timestamp.now();
        taskFound = true;
      }
    });
  });

  if (!taskFound) {
    throw new Error("Task not found");
  }

  // Calculate new completion percentage
  let totalTasks = 0;
  let completedTasks = 0;
  plan.dailyTasks.forEach((day) => {
    day.tasks.forEach((task) => {
      totalTasks++;
      if (task.completed) completedTasks++;
    });
  });

  plan.completionPercentage = Math.round((completedTasks / totalTasks) * 100);
  plan.lastUpdated = Timestamp.now();

  // Update document
  await db.collection("study_buddy_revision_plans").doc(planId).set(plan);
}

/**
 * Get revision plan by ID
 */
export async function getRevisionPlan(
  planId: string,
  userId: string
): Promise<StudyBuddyRevisionPlan> {
  const planDoc = await db
    .collection("study_buddy_revision_plans")
    .doc(planId)
    .get();

  if (!planDoc.exists) {
    throw new Error("Revision plan not found");
  }

  const plan = planDoc.data() as StudyBuddyRevisionPlan;

  // Verify ownership
  if (plan.userId !== userId) {
    throw new Error("Unauthorized");
  }

  return plan;
}

/**
 * Get all revision plans for a user
 */
export async function getUserRevisionPlans(
  userId: string
): Promise<StudyBuddyRevisionPlan[]> {
  const plansSnapshot = await db
    .collection("study_buddy_revision_plans")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .get();

  return plansSnapshot.docs.map((doc) => doc.data() as StudyBuddyRevisionPlan);
}
