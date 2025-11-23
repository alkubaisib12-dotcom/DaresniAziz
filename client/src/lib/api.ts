// src/lib/api.ts
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---- Sessions ----
export type ApiUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
};

export type ApiSubject = {
  id: string;
  name?: string;
  description?: string;
  category?: string;
};

export type ApiTutorProfile = {
  id: string;
  userId: string;
  bio?: string;
  phone?: string;
  hourlyRate?: number;
  isVerified?: boolean;
  isActive?: boolean;
  user?: ApiUser; // when server returns tutor with joined user
};

export type ApiSession = {
  id: string;
  tutorId: string;     // NOTE: this is tutor_profile.id
  studentId: string;   // user.id
  subjectId: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  scheduledAt: any;    // could be ISO string or { _seconds, _nanoseconds }
  duration?: number;
  meetingLink?: string | null;
  notes?: string;
  priceCents?: number;

  // AI-Generated Lesson Summary fields
  tutorNotes?: string;
  aiSummary?: {
    whatWasLearned: string;
    mistakes: string;
    strengths: string;
    practiceTasks: string;
    generatedAt?: any;
  };

  // role-shaped joins coming from /api/sessions
  tutor?: (ApiTutorProfile & { user?: ApiUser }) | null;
  student?: ApiUser | null;
  subject?: ApiSubject | null;
};

export async function fetchSessions(limit = 50) {
  return api<ApiSession[]>(`/api/sessions?limit=${limit}`);
}

export async function updateTutorNotes(sessionId: string, tutorNotes: string) {
  return api<ApiSession>(`/api/sessions/${sessionId}/tutor-notes`, {
    method: "PUT",
    body: JSON.stringify({ tutorNotes }),
    headers: { "Content-Type": "application/json" },
  });
}

export async function generateAISummary(sessionId: string) {
  return api<ApiSession>(`/api/sessions/${sessionId}/generate-summary`, {
    method: "POST",
  });
}

// ---- Quiz Functions ----
export type QuizQuestion = {
  question: string;
  type: "multiple_choice" | "true_false";
  options?: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
};

export type SessionQuiz = {
  id: string;
  sessionId: string;
  questions: QuizQuestion[];
  focusAreas: string[];
  difficulty: "easy" | "medium" | "hard";
  createdAt: any;
  aiGenerated: boolean;
};

export type QuizAttempt = {
  id: string;
  quizId: string;
  sessionId: string;
  studentId: string;
  answers: Record<number, string>;
  score: number;
  correctCount: number;
  totalQuestions: number;
  detailedResults: Array<{
    questionIndex: number;
    question: string;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    explanation: string;
    topic: string;
  }>;
  completedAt: any;
};

export async function generateSessionQuiz(sessionId: string) {
  return api<SessionQuiz>(`/api/sessions/${sessionId}/generate-quiz`, {
    method: "POST",
  });
}

export async function getSessionQuiz(sessionId: string) {
  return api<{ quiz: SessionQuiz; attempt: QuizAttempt | null }>(`/api/sessions/${sessionId}/quiz`, {
    method: "GET",
  });
}

export async function submitQuizAnswers(sessionId: string, answers: Record<number, string>) {
  return api<QuizAttempt>(`/api/sessions/${sessionId}/quiz/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
    headers: { "Content-Type": "application/json" },
  });
}

// ---- Notifications ----
export type ApiNotification = {
  id: string;
  type: string;
  title: string;
  body?: string;
  audience?: "tutor" | "admin";
  userId?: string;         // targeted user
  data?: Record<string, unknown>;
  isRead?: boolean;
  createdAt?: any;
};

export async function fetchNotifications() {
  return api<ApiNotification[]>(`/api/notifications`);
}

export async function markNotificationRead(id: string) {
  return api<{ message: string }>(`/api/notifications/${id}/read`, {
    method: "POST",
  });
}
