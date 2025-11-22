// shared/types.ts
// Canonical Firestore-first types used across client & server.
// NOTE: Dates are JS Date objects on the client; convert to Firestore Timestamp when persisting.

export type UserRole = 'student' | 'tutor' | 'admin';

/* =========================
 *          USER
 * =======================*/
export interface User {
  id: string;                 // Firebase Auth UID
  email: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string | null;
  role: UserRole;
  lastNameChangeAt?: Date | null;  // Track when user last changed their name (7-day limit)

  // Tutor-related (optional at user level; full details live in TutorProfile)
  phone?: string;
  education?: string;
  experience?: string;
  bio?: string;
  hourlyRate?: number;        // prefer number here (use cents in Session for pricing)
  linkedinProfile?: string;
  certifications?: string;
  isVerified?: boolean;
  verificationStatus?: 'pending' | 'approved' | 'rejected';

  createdAt?: Date;
  updatedAt?: Date;
}

/* =========================
 *        SUBJECT
 * =======================*/
export interface Subject {
  id: string;
  name: string;
  description?: string;
  category?: string;
  createdAt?: Date;
}

/* =========================
 *      TUTOR PROFILE
 * =======================*/
export interface TutorProfile {
  id: string;                 // Firestore doc id for the tutor profile
  userId: string;             // references User.id (Firebase UID)
  bio?: string;
  hourlyRate?: number;        // e.g., 15 (your currency unit) - DEPRECATED: use subjectPricing instead
  subjectPricing?: {          // pricing per subject
    [subjectId: string]: number; // subjectId -> price
  };
  subjects?: string[];        // array of Subject.id
  availability?: {
    [day: string]: {          // e.g., "monday", "tuesday", ...
      startTime: string;      // "09:00"
      endTime: string;        // "17:00"
      isAvailable: boolean;
    };
  };
  certifications?: Array<{    // certification files
    url: string;
    name: string;
  }>;
  verified?: boolean;
  rating?: number;
  totalReviews?: number;
  totalSessions?: number;
  profileImageUrl?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}

/* =========================
 *        SESSIONS
 * =======================*/
export type SessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface SessionDoc {
  id?: string;                // Firestore doc id
  studentId: string;          // User.id (Firebase UID)
  tutorId: string;            // TutorProfile.id OR User.id (decide one and keep consistent)
  subjectId: string;          // Subject.id
  scheduledAt: Date;          // client uses Date; convert to Timestamp when saving
  duration: number;           // minutes
  timeSlots?: string[];       // array of booked time slots in HH:MM format, e.g., ["10:00", "11:00", "16:00"]
  status: SessionStatus;      // default 'scheduled'
  meetingLink?: string | null;
  notes?: string;             // optional free text
  priceCents: number;         // store monetary values as integer cents

  // AI-Generated Lesson Summary fields
  tutorNotes?: string;        // Raw notes from tutor after session
  aiSummary?: {
    whatWasLearned: string;   // Topics and concepts covered
    mistakes: string;          // Common mistakes the student made
    strengths: string;         // Student's strengths and achievements
    practiceTasks: string;     // Actionable tasks for practice
    generatedAt?: Date;        // When the summary was generated
  };

  createdAt?: Date;
  updatedAt?: Date;
}

/* =========================
 *         REVIEWS
 * =======================*/
export interface Review {
  id?: string;
  sessionId: string;          // SessionDoc.id
  studentId: string;          // User.id
  tutorId: string;            // TutorProfile.id or User.id (match your choice above)
  rating: number;             // 1–5
  comment?: string;
  createdAt?: Date;
}

/* =========================
 *         MESSAGES
 * =======================*/
export interface Message {
  id?: string;
  senderId: string;           // User.id
  receiverId: string;         // User.id
  sessionId?: string | null;  // optional link to a session
  content: string;
  fileUrl?: string | null;
  read?: boolean;
  createdAt?: Date;
}

/* =========================
 *       FILE UPLOADS
 * =======================*/
export interface FileUpload {
  id?: string;
  uploaderId: string;         // User.id
  fileName: string;
  fileUrl: string;
  fileSize?: number;
  mimeType?: string;
  sessionId?: string | null;
  createdAt?: Date;
}

/* =========================
 *     CREATE / UPDATE DTOs
 * =======================*/

// Users
export type CreateUser = Omit<User, 'id' | 'createdAt' | 'updatedAt'> & { id: string };
export type UpdateUser = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>;

// Subjects
export type CreateSubject = Omit<Subject, 'id' | 'createdAt'>;
export type UpdateSubject = Partial<Omit<Subject, 'id' | 'createdAt'>>;

// Tutor Profiles
export type CreateTutorProfile = Omit<TutorProfile, 'id' | 'createdAt' | 'updatedAt' | 'totalReviews' | 'totalSessions' | 'rating'> & {
  id?: string;
};
export type UpdateTutorProfile = Partial<Omit<TutorProfile, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

// Sessions (Booking)
export type CreateSession = Omit<SessionDoc, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
  status?: SessionStatus;     // default handled in code: 'scheduled'
};
export type UpdateSession = Partial<Omit<SessionDoc, 'id' | 'createdAt' | 'updatedAt'>>;

// Reviews
export type CreateReview = Omit<Review, 'id' | 'createdAt'>;

// Messages
export type CreateMessage = Omit<Message, 'id' | 'read' | 'createdAt'>;

// Files
export type CreateFileUpload = Omit<FileUpload, 'id' | 'createdAt'>;
