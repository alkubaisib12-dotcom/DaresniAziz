import express, { type Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import type * as FirebaseFirestore from "@google-cloud/firestore";

import { requireUser, requireAdmin, type AuthUser, fdb } from "./firebase-admin";
import { z } from "zod";
import { sendToAdmins, createTutorRegistrationEmail } from "./email";
import { TutorRankingService } from "./services/tutorRanking";
import studyBuddyRoutes from "./routes/studyBuddyRoutes";

const chooseRoleSchema = z.object({
  role: z.enum(["student", "tutor", "admin"]),
});

const updateTutorProfileSchema = z.object({
  bio: z.string().min(1).optional(),
  phone: z.string().min(5).optional(),
  hourlyRate: z.number().nonnegative().optional(),
  subjectPricing: z.record(z.string(), z.number().nonnegative()).optional(), // subject-specific pricing
  subjects: z.array(z.string()).optional(),

  // extra profile fields
  education: z.string().min(1).optional(),
  experience: z.string().min(1).optional(),
  certifications: z.array(z.object({
    url: z.string(),
    name: z.string(),
  })).optional(),

  // weekly availability (mon..sun) -> { isAvailable, startTime, endTime }
  availability: z
    .record(
      z.string(), // e.g., "monday"
      z.object({
        isAvailable: z.boolean(),
        startTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h format")
          .optional(),
        endTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h format")
          .optional(),
      })
    )
    .optional(),
});

const insertFavoriteSchema = z.object({
  userId: z.string(),
  tutorId: z.string(),
});

const insertSessionSchema = z.object({
  tutorId: z.string(), // can be tutor_profiles.id OR the tutor's userId (handled below)
  subjectId: z.string(),
  studentId: z.string(),
  scheduledAt: z.union([z.string(), z.date()]),
  duration: z.number().int().positive().optional(), // minutes
  durationMinutes: z.number().int().positive().optional(), // also accepted
  status: z
    .enum(["pending", "scheduled", "in_progress", "completed", "cancelled"])
    .optional(),
});

const createReviewSchema = z.object({
  tutorId: z.string(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// IN-MEMORY CACHING FOR HEAVY READ ENDPOINTS
// ============================================================
// Cache for /api/subjects
let cachedSubjects: any[] | null = null;
let cachedSubjectsFetchedAt = 0;
const SUBJECTS_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache for /api/stats
let cachedStats: { tutors: number; students: number; sessions: number } | null = null;
let cachedStatsFetchedAt = 0;
const STATS_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Cache for /api/tutors
let cachedTutors: any[] | null = null;
let cachedTutorsFetchedAt = 0;
const TUTORS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function now() {
  return new Date();
}

async function getDoc<T = any>(collection: string, id: string) {
  const snap = await fdb!.collection(collection).doc(id).get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as T & { id: string }) : null;
}

async function listCollection<T = any>(
  collection: string,
  whereClauses?: Array<[string, FirebaseFirestore.WhereFilterOp, any]>,
  order?: [string, FirebaseFirestore.OrderByDirection?],
  limitN?: number
) {
  let q: FirebaseFirestore.Query = fdb!.collection(collection);
  if (whereClauses) for (const [f, op, v] of whereClauses) q = q.where(f, op, v);
  if (order) {
    const [field, dir] = order;
    q = q.orderBy(field, dir);
  }
  if (limitN) q = q.limit(limitN);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<T & { id: string }>;
}

// ---- batched loaders (faster joins) ----
async function batchLoadMap<T = any>(collection: string, ids: string[]): Promise<Map<string, T & { id: string }>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, T & { id: string }>();
  if (unique.length === 0) return map;

  const refs = unique.map((id) => fdb!.collection(collection).doc(id));
  // @ts-ignore - getAll exists on Admin Firestore
  const snaps: FirebaseFirestore.DocumentSnapshot[] = await (fdb as any).getAll(...refs);
  for (const s of snaps) {
    if (s.exists) map.set(s.id, { id: s.id, ...(s.data() as any) });
  }
  return map;
}

function coerceMillis(v: any): number {
  if (!v) return 0;
  if (typeof (v as any).toDate === "function") return (v as any).toDate().getTime(); // Firestore Timestamp
  if (typeof v === "object" && typeof (v as any)._seconds === "number") return (v as any)._seconds * 1000; // serialized TS
  return new Date(v as any).getTime();
}

async function upsertUserFromReqUser(user: AuthUser) {
  const ref = fdb!.collection("users").doc(user.id);
  await ref.set(
    {
      email: user.email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      role: user.role ?? null,
      updatedAt: now(),
    },
    { merge: true }
  );
}

/* =======================
   Availability utilities
   ======================= */

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type DayKey = (typeof DAY_KEYS)[number];

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
function toDayKey(date: Date): DayKey {
  return DAY_KEYS[date.getDay()];
}
function parseHHMM(hhmm: string | undefined, fallback: string): { h: number; m: number } {
  const v = hhmm || fallback;
  const [h, m] = v.split(":").map((n) => Number(n));
  return { h: Math.max(0, Math.min(23, h || 0)), m: Math.max(0, Math.min(59, m || 0)) };
}
function* generateSlots(startHHmm: string, endHHmm: string, stepMinutes = 60) {
  // generate slot labels (HH:mm) in [start,end] with step
  const [sh, sm] = startHHmm.split(":").map(Number);
  const [eh, em] = endHHmm.split(":").map(Number);
  const base = new Date();
  base.setHours(sh, sm, 0, 0);
  const end = new Date();
  end.setHours(eh, em, 0, 0);

  const cur = new Date(base);
  while (cur < end) {
    const next = new Date(cur.getTime() + stepMinutes * 60_000);
    if (next <= end) {
      const hh = cur.getHours().toString().padStart(2, "0");
      const mm = cur.getMinutes().toString().padStart(2, "0");
      const ehh = next.getHours().toString().padStart(2, "0");
      const emm = next.getMinutes().toString().padStart(2, "0");
      yield { start: `${hh}:${mm}`, end: `${ehh}:${emm}` };
    }
    cur.setTime(next.getTime());
  }
}
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

// helpers for YYYY-MM-DD → Date(00:00 local)
function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  const dt = new Date();
  dt.setFullYear(isNaN(y) ? dt.getFullYear() : y);
  dt.setMonth(isNaN(m) ? dt.getMonth() : m - 1, isNaN(d) ? dt.getDate() : d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function parseDateParam(s?: string): Date {
  if (!s) {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseYMD(s);
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

/* =======================
   Sessions join helper
   ======================= */

async function fetchSessionsForUser(user: AuthUser, limit: number): Promise<any[]> {
  const readSafely = async (base: FirebaseFirestore.Query) => {
    try {
      const snap = await base.orderBy("scheduledAt", "desc").limit(limit).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    } catch (e: any) {
      if (e?.code === 9) {
        const snap = await base.limit(limit).get();
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        arr.sort((a, b) => coerceMillis(b.scheduledAt) - coerceMillis(a.scheduledAt));
        return arr;
      }
      throw e;
    }
  };

  let raw: any[] = [];
  let tProfile: any | null = null;

  if (user.role === "student") {
    raw = await readSafely(fdb!.collection("tutoring_sessions").where("studentId", "==", user.id));
  } else if (user.role === "tutor") {
    const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
    if (profSnap.empty) return [];
    tProfile = { id: profSnap.docs[0].id, ...profSnap.docs[0].data() } as any;
    raw = await readSafely(fdb!.collection("tutoring_sessions").where("tutorId", "==", tProfile.id));
  } else {
    // admin / unknown -> all
    raw = await readSafely(fdb!.collection("tutoring_sessions"));
  }

  // Collect unique ids for batched lookups
  const tutorProfileIds = Array.from(new Set(raw.map((s) => s.tutorId).filter(Boolean)));
  const studentIds = Array.from(new Set(raw.map((s) => s.studentId).filter(Boolean)));
  const subjectIds = Array.from(new Set(raw.map((s) => s.subjectId).filter(Boolean)));

  const [mapTutorProfiles, mapStudents, mapSubjects] = await Promise.all([
    batchLoadMap<any>("tutor_profiles", tutorProfileIds),
    batchLoadMap<any>("users", studentIds),
    batchLoadMap<any>("subjects", subjectIds),
  ]);

  // For tutors we also need joined tutor user documents:
  const tutorUserIds = Array.from(
    new Set(
      tutorProfileIds
        .map((tid) => mapTutorProfiles.get(tid)?.userId)
        .filter(Boolean) as string[]
    )
  );
  const mapTutorUsers = await batchLoadMap<any>("users", tutorUserIds);

  const formatted = raw.map((s) => {
    const subject = mapSubjects.get(s.subjectId) || null;
    if (user.role === "student") {
      const tProf = mapTutorProfiles.get(s.tutorId) || null;
      const tUser = tProf ? mapTutorUsers.get(tProf.userId) || null : null;
      return { ...s, subject, tutor: tProf ? { ...tProf, user: tUser } : null };
    } else if (user.role === "tutor") {
      const student = mapStudents.get(s.studentId) || null;
      return { ...s, subject, student };
    } else {
      const tProf = mapTutorProfiles.get(s.tutorId) || null;
      const tUser = tProf ? mapTutorUsers.get(tProf.userId) || null : null;
      const student = mapStudents.get(s.studentId) || null;
      return { ...s, subject, tutor: tProf ? { ...tProf, user: tUser } : null, student };
    }
  });

  return formatted;
}
async function autoCompleteSessions(cutoff: Date): Promise<{
  checked: number;
  completed: number;
}> {
  if (!fdb) throw new Error("Firestore not initialized");

  const col = fdb.collection("tutoring_sessions");

  // To avoid composite index issues, query each status separately
  const [scheduledSnap, inProgressSnap] = await Promise.all([
    col.where("status", "==", "scheduled").where("scheduledAt", "<=", cutoff).get(),
    col.where("status", "==", "in_progress").where("scheduledAt", "<=", cutoff).get(),
  ]);

  const docs = [...scheduledSnap.docs, ...inProgressSnap.docs];

  let checked = 0;
  let completed = 0;

  let batch = fdb.batch();
  let ops = 0;

  for (const d of docs) {
    const data = d.data() as any;
    checked++;

    const start = new Date(coerceMillis(data.scheduledAt));
    const durationMinutes = Number(data.duration ?? 60);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    // Only auto-complete if the calculated end time has actually passed
    if (end <= cutoff) {
      batch.update(d.ref, {
        status: "completed",
        updatedAt: now(),
      });
      completed++;
      ops++;

      // Commit in chunks to respect batch limits
      if (ops >= 400) {
        await batch.commit();
        batch = fdb.batch();
        ops = 0;
      }
    }
  }

  if (ops > 0) {
    await batch.commit();
  }

  console.log(
    `autoCompleteSessions: checked=${checked}, completed=${completed}, cutoff=${cutoff.toISOString()}`
  );

  return { checked, completed };
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/initialize-firebase.html", (req, res) => {
    const initFilePath = path.join(__dirname, "../initialize-firebase.html");
    if (fs.existsSync(initFilePath)) res.sendFile(initFilePath);
    else res.status(404).send("Initialization file not found");
  });

  app.get("/api/health", async (_req, res) => {
    res.json({ status: "ok", message: "Server is running" });
  });

  app.get("/api/stats", async (_req, res) => {
    try {
      // Check cache first
      const now = Date.now();
      if (cachedStats && (now - cachedStatsFetchedAt) < STATS_TTL_MS) {
        console.log("[/api/stats] Serving from cache");
        return res.json(cachedStats);
      }

      // Cache miss - fetch from Firestore
      console.log("[/api/stats] Fetching from Firestore");
      const tutorsAgg = await fdb!
        .collection("tutor_profiles")
        .where("isVerified", "==", true)
        .where("isActive", "==", true)
        .count()
        .get();

      const studentsAgg = await fdb!.collection("users").where("role", "==", "student").count().get();

      const completedAgg = await fdb!
        .collection("tutoring_sessions")
        .where("status", "==", "completed")
        .count()
        .get();

      const stats = {
        tutors: tutorsAgg.data().count || 0,
        students: studentsAgg.data().count || 0,
        sessions: completedAgg.data().count || 0,
      };

      // Update cache
      cachedStats = stats;
      cachedStatsFetchedAt = now;

      res.json(stats);
    } catch (error) {
      console.error("Error fetching platform stats:", error);
      res.status(500).json({ message: "Failed to fetch platform statistics", fieldErrors: {} });
    }
  });

  const uploadsDir = path.join(process.cwd(), "uploads");
  app.use(
    "/uploads",
    express.static(uploadsDir, {
      fallthrough: false,
      index: false,
      redirect: false,
    })
  );

  // Simple user lookup for chat header, etc.
  app.get("/api/users/:id", requireUser, async (req, res) => {
    try {
      const { id } = req.params;
      const userDoc = await getDoc<any>("users", id);
      if (!userDoc) {
        return res.status(404).json({ message: "User not found", fieldErrors: {} });
      }

      res.json({
        id: userDoc.id,
        email: userDoc.email ?? null,
        firstName: userDoc.firstName ?? null,
        lastName: userDoc.lastName ?? null,
        profileImageUrl: userDoc.profileImageUrl ?? null,
        role: userDoc.role ?? null,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user", fieldErrors: {} });
    }
  });

  // === AUTH ===
  app.get("/api/me", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      await upsertUserFromReqUser(user);

      const tutorSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
      const tutorProfile = tutorSnap.empty ? null : { id: tutorSnap.docs[0].id, ...tutorSnap.docs[0].data() };

      res.set("Cache-Control", "private, max-age=10");
      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          profileImageUrl: user.profileImageUrl ?? null,
          role: user.role ?? null,
        },
        hasTutorProfile: !!tutorProfile,
        tutorProfile: tutorProfile || undefined,
      });
    } catch (error) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ message: "Failed to fetch user data", fieldErrors: {} });
    }
  });

  app.put("/api/user/profile", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const updateSchema = z.object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        profileImageUrl: z.string().optional().or(z.literal("")).nullable(),
      });
      const updateData = updateSchema.parse(req.body);
      if (updateData.profileImageUrl === "") delete (updateData as any).profileImageUrl;

      // Check if name is being changed
      const nameChanged =
        (updateData.firstName && updateData.firstName !== user.firstName) ||
        (updateData.lastName && updateData.lastName !== user.lastName);

      const ref = fdb!.collection("users").doc(user.id);
      const dataToUpdate: any = { ...updateData, updatedAt: now() };

      // If name changed, update lastNameChangeAt timestamp
      if (nameChanged) {
        dataToUpdate.lastNameChangeAt = now();
      }

      await ref.set(dataToUpdate, { merge: true });

      const snap = await ref.get();
      const updatedUser = { id: snap.id, ...snap.data() } as any;

      res.json({
        message: "Profile updated successfully",
        user: {
          id: updatedUser.id,
          email: updatedUser.email ?? user.email,
          firstName: updatedUser.firstName ?? null,
          lastName: updatedUser.lastName ?? null,
          profileImageUrl: updatedUser.profileImageUrl ?? null,
          role: updatedUser.role ?? null,
        },
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid request data", fieldErrors: error.flatten().fieldErrors });
      } else {
        res.status(500).json({ message: "Failed to update profile", fieldErrors: {} });
      }
    }
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  // Upload handler for certifications (PDF support)
  const certUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for PDFs
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) {
        cb(null, true);
      } else {
        cb(new Error("Only PDF and image files are allowed"));
      }
    },
  });

  app.post("/api/upload", requireUser, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const user = req.user!;
      const file = req.file;
      const fileExt = path.extname(file.originalname);
      const fileName = `profile-${user.id}-${Date.now()}${fileExt}`;
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, fileName);
      await fs.promises.writeFile(filePath, file.buffer);
      const fileUrl = `/uploads/${fileName}`;

      res.json({ url: fileUrl, message: "File uploaded successfully" });
    } catch (error) {
      console.error("Upload error:", error);
      res
        .status(500)
        .json({ message: "Failed to upload file", error: error instanceof Error ? error.message : "Unknown" });
    }
  });

  // Upload certification files (PDF + images)
  app.post("/api/upload-certification", requireUser, certUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const user = req.user!;
      const file = req.file;
      const fileExt = path.extname(file.originalname);
      const fileName = `cert-${user.id}-${Date.now()}${fileExt}`;
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, fileName);
      await fs.promises.writeFile(filePath, file.buffer);
      const fileUrl = `/uploads/${fileName}`;

      res.json({ url: fileUrl, message: "Certification uploaded successfully", fileName: file.originalname });
    } catch (error) {
      console.error("Certification upload error:", error);
      res
        .status(500)
        .json({ message: "Failed to upload certification", error: error instanceof Error ? error.message : "Unknown" });
    }
  });

  app.post("/api/auth/choose-role", requireUser, async (req, res) => {
    try {
      const { role } = chooseRoleSchema.parse(req.body);
      const user = req.user!;
      if (role === "admin")
        return res.status(403).json({ message: "Admin role cannot be self-assigned", fieldErrors: {} });

      const userRef = fdb!.collection("users").doc(user.id);
      await userRef.set({ role, updatedAt: now() }, { merge: true });

      if (role === "tutor") {
        const profileSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
        if (profileSnap.empty) {
          await fdb!.collection("tutor_profiles").add({
            userId: user.id,
            isVerified: false,
            isActive: false,
            createdAt: now(),
            updatedAt: now(),
          });
        }
      }
      res.json({ ok: true, role });
    } catch (error) {
      console.error("Error choosing role:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid request data", fieldErrors: error.flatten().fieldErrors });
      } else {
        res.status(500).json({ message: "Failed to update role", fieldErrors: {} });
      }
    }
  });

  // === SUBJECTS ===
  app.get("/api/subjects", async (_req, res) => {
    try {
      if (!fdb) return res.status(500).json({ message: "Firestore not initialized" });

      // Check cache first
      const now = Date.now();
      if (cachedSubjects && (now - cachedSubjectsFetchedAt) < SUBJECTS_TTL_MS) {
        console.log("[/api/subjects] Serving from cache");
        res.set("Cache-Control", "public, max-age=60");
        return res.json(cachedSubjects);
      }

      // Cache miss - fetch from Firestore
      console.log("[/api/subjects] Fetching from Firestore");
      const snap = await fdb.collection("subjects").orderBy("name").get();
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      // Update cache
      cachedSubjects = all;
      cachedSubjectsFetchedAt = now;

      res.set("Cache-Control", "public, max-age=60");
      res.json(all);
    } catch (err) {
      console.error("Error fetching subjects:", err);
      res.status(500).json({ message: "Failed to fetch subjects", fieldErrors: {} });
    }
  });

  app.post("/api/admin/seed-subjects", requireUser, requireAdmin, async (_req, res) => {
    try {
      if (!fdb) return res.status(500).json({ message: "Firestore not initialized" });
      const basic = [
        {
          id: "math",
          name: "Mathematics",
          description: "Math tutoring from basic arithmetic to advanced calculus",
          category: "STEM",
        },
        { id: "science", name: "Science", description: "Biology, chemistry, and physics", category: "STEM" },
        {
          id: "english",
          name: "English",
          description: "Language arts, writing, and literature",
          category: "Language Arts",
        },
        { id: "history", name: "History", description: "World history, social studies", category: "Social Studies" },
        { id: "computer-science", name: "Computer Science", description: "Programming and CS concepts", category: "STEM" },
      ];
      const batch = fdb.batch();
      for (const s of basic) {
        const ref = fdb.collection("subjects").doc(s.id);
        batch.set(
          ref,
          { name: s.name, description: s.description, category: s.category, createdAt: new Date(), updatedAt: new Date() },
          { merge: true }
        );
      }
      await batch.commit();

      // Invalidate subjects cache
      cachedSubjects = null;
      console.log("[Cache] Subjects cache invalidated");

      res.json({ message: "Basic subjects seeded successfully" });
    } catch (err) {
      console.error("Error seeding subjects:", err);
      res.status(500).json({ message: "Failed to seed subjects", fieldErrors: {} });
    }
  });

  // === TUTOR PROFILE (self) ===
  app.get("/api/tutors/profile", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
      if (profSnap.empty) return res.status(404).json({ message: "Tutor profile not found", fieldErrors: {} });

      const profile = { id: profSnap.docs[0].id, ...profSnap.docs[0].data() } as any;
      const joinedUser = await getDoc<any>("users", profile.userId);

      const tsSnap = await fdb!.collection("tutor_subjects").where("tutorId", "==", profile.id).get();
      const subjectIds = tsSnap.docs.map((d) => d.get("subjectId"));
      let subjects: any[] = [];
      if (subjectIds.length) {
        const map = await batchLoadMap<any>("subjects", subjectIds);
        subjects = subjectIds
          .map((sid) => (map.get(sid) ? { id: sid, ...map.get(sid)! } : null))
          .filter(Boolean) as any[];
      }

      res.json({ ...profile, user: joinedUser, subjects });
    } catch (error) {
      console.error("Error fetching tutor profile:", error);
      res.status(500).json({ message: "Failed to fetch tutor profile", fieldErrors: {} });
    }
  });

  app.post("/api/tutors/profile", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const profileData = updateTutorProfileSchema.parse(req.body);
      const { subjects: subjectIds, ...tutorData } = profileData as any;

      const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();

      let profileId: string;
      if (!profSnap.empty) {
        const ref = profSnap.docs[0].ref;
        profileId = ref.id;
        await ref.set({ ...tutorData, updatedAt: now() }, { merge: true });
      } else {
        const added = await fdb!.collection("tutor_profiles").add({
          userId: user.id,
          isVerified: false,
          isActive: false,
          createdAt: now(),
          updatedAt: now(),
          ...tutorData,
        });
        profileId = added.id;
      }

      if (Array.isArray(subjectIds)) {
        const existing = await fdb!.collection("tutor_subjects").where("tutorId", "==", profileId).get();
        const batchDel = fdb!.batch();
        existing.docs.forEach((d) => batchDel.delete(d.ref));
        await batchDel.commit();

        if (subjectIds.length > 0) {
          const batchIns = fdb!.batch();
          subjectIds.forEach((sid: string) => {
            batchIns.set(fdb!.collection("tutor_subjects").doc(`${profileId}_${sid}`), {
              tutorId: profileId,
              subjectId: sid,
            });
          });
          await batchIns.commit();
        }
      }

      const tutorName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown";
      await fdb!.collection("notifications").add({
        type: "TUTOR_REGISTERED",
        title: "New tutor registered",
        body: `${tutorName} (${user.email})`,
        data: { userId: user.id },
        audience: "admin",
        isRead: false,
        createdAt: now(),
      });

      try {
        const emailContent = createTutorRegistrationEmail(tutorName, user.email);
        await sendToAdmins(emailContent.subject, emailContent.html, emailContent.text);
      } catch (emailError) {
        console.error("Failed to send admin notification email:", emailError);
      }

      const finalProfile = await getDoc<any>("tutor_profiles", profileId);
      const joinedUser = await getDoc<any>("users", finalProfile!.userId);

      const tsSnap = await fdb!.collection("tutor_subjects").where("tutorId", "==", profileId).get();
      const sids = tsSnap.docs.map((d) => d.get("subjectId"));
      let subjects: any[] = [];
      if (sids.length) {
        const map = await batchLoadMap<any>("subjects", sids);
        subjects = sids.map((sid) => (map.get(sid) ? { id: sid, ...map.get(sid)! } : null)).filter(Boolean) as any[];
      }

      // Invalidate tutors cache since profile was created/updated
      cachedTutors = null;
      console.log("[Cache] Tutors cache invalidated");

      res.json({ profile: finalProfile, user: joinedUser, subjects });
    } catch (error) {
      console.error("Error creating tutor profile:", error instanceof Error ? error.message : String(error));
      if (error instanceof z.ZodError) {
        console.error("Validation errors:", JSON.stringify(error.flatten().fieldErrors));
        res.status(400).json({ message: "Invalid request data", fieldErrors: error.flatten().fieldErrors });
      } else {
        res.status(500).json({ message: "Failed to create tutor profile", fieldErrors: {} });
      }
    }
  });

  app.put("/api/tutors/profile", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const updateData = updateTutorProfileSchema.parse(req.body);
      const { subjects: subjectIds, ...profileData } = updateData as any;

      const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
      if (profSnap.empty) return res.status(404).json({ message: "Tutor profile not found", fieldErrors: {} });

      const ref = profSnap.docs[0].ref;
      const existingProfile = { id: ref.id, ...profSnap.docs[0].data() } as any;
      const isFirstCompletion = !existingProfile.bio && !existingProfile.phone && !existingProfile.hourlyRate;

      await ref.set({ ...profileData, updatedAt: now() }, { merge: true });

      if (Array.isArray(subjectIds)) {
        const existing = await fdb!.collection("tutor_subjects").where("tutorId", "==", ref.id).get();
        const batch = fdb!.batch();
        existing.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();

        if (subjectIds.length > 0) {
          const batch2 = fdb!.batch();
          subjectIds.forEach((sid: string) => {
            const dref = fdb!.collection("tutor_subjects").doc(`${ref.id}_${sid}`);
            batch2.set(dref, { tutorId: ref.id, subjectId: sid });
          });
          await batch2.commit();
        }
      }

      if (isFirstCompletion && (profileData.bio || profileData.phone || profileData.hourlyRate)) {
        const tutorName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown";
        await fdb!.collection("notifications").add({
          type: "TUTOR_REGISTERED",
          title: "New tutor registered",
          body: `${tutorName} (${user.email})`,
          data: { userId: user.id },
          audience: "admin",
          isRead: false,
          createdAt: now(),
        });

        try {
          const emailContent = createTutorRegistrationEmail(tutorName, user.email);
          await sendToAdmins(emailContent.subject, emailContent.html, emailContent.text);
        } catch (emailError) {
          console.error("Failed to send admin notification email:", emailError);
        }
      }

      const updatedProfile = await ref.get();
      const joinedUser = await getDoc<any>("users", user.id);

      const tsSnap = await fdb!.collection("tutor_subjects").where("tutorId", "==", ref.id).get();
      const sids = tsSnap.docs.map((d) => d.get("subjectId"));
      let subjects: any[] = [];
      if (sids.length) {
        const map = await batchLoadMap<any>("subjects", sids);
        subjects = sids.map((sid) => (map.get(sid) ? { id: sid, ...map.get(sid)! } : null)).filter(Boolean) as any[];
      }

      // Invalidate tutors cache since profile was updated
      cachedTutors = null;
      console.log("[Cache] Tutors cache invalidated");

      res.json({ profile: { id: ref.id, ...updatedProfile.data() }, user: joinedUser, subjects });
    } catch (error) {
      console.error("Error updating tutor profile:", error instanceof Error ? error.message : String(error));
      if (error instanceof z.ZodError) {
        console.error("Validation errors:", JSON.stringify(error.flatten().fieldErrors));
        res.status(400).json({ message: "Invalid request data", fieldErrors: error.flatten().fieldErrors });
      } else {
        res.status(500).json({ message: "Failed to update tutor profile", fieldErrors: {} });
      }
    }
  });

  /* =========================
     Schedule Templates
     ========================= */

  // Get all schedule templates for current tutor
  app.get("/api/tutors/schedule-templates", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      if (user.role !== "tutor") {
        return res.status(403).json({ message: "Only tutors can access schedule templates" });
      }

      const templates = await listCollection<any>(
        "schedule_templates",
        [["userId", "==", user.id]],
        ["createdAt", "desc"]
      );

      res.json(templates);
    } catch (error) {
      console.error("Error fetching schedule templates:", error);
      res.status(500).json({ message: "Failed to fetch schedule templates" });
    }
  });

  // Save a new schedule template
  app.post("/api/tutors/schedule-templates", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      if (user.role !== "tutor") {
        return res.status(403).json({ message: "Only tutors can save schedule templates" });
      }

      const { name, availability } = req.body;
      if (!name || !availability) {
        return res.status(400).json({ message: "Name and availability are required" });
      }

      const templateRef = await fdb!.collection("schedule_templates").add({
        userId: user.id,
        name: name.trim(),
        availability,
        createdAt: now(),
      });

      const template = await templateRef.get();
      res.json({ id: template.id, ...template.data() });
    } catch (error) {
      console.error("Error saving schedule template:", error);
      res.status(500).json({ message: "Failed to save schedule template" });
    }
  });

  // Delete a schedule template
  app.delete("/api/tutors/schedule-templates/:id", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const templateDoc = await getDoc<any>("schedule_templates", id);
      if (!templateDoc) {
        return res.status(404).json({ message: "Template not found" });
      }

      if (templateDoc.userId !== user.id) {
        return res.status(403).json({ message: "You can only delete your own templates" });
      }

      await fdb!.collection("schedule_templates").doc(id).delete();
      res.json({ message: "Template deleted successfully" });
    } catch (error) {
      console.error("Error deleting schedule template:", error);
      res.status(500).json({ message: "Failed to delete schedule template" });
    }
  });

  /* =========================
     Public tutor availability
     ========================= */

  // GET /api/tutors/:id/availability?date=YYYY-MM-DD&step=60
  // :id is tutor_profiles.id
  app.get("/api/tutors/:id/availability", async (req, res) => {
    try {
      const tutorProfileId = req.params.id;

      let profile = await getDoc<any>("tutor_profiles", tutorProfileId);
      if (!profile) {
        const byUser = await fdb!
          .collection("tutor_profiles")
          .where("userId", "==", tutorProfileId)
          .limit(1)
          .get();
        if (!byUser.empty) {
          profile = { id: byUser.docs[0].id, ...byUser.docs[0].data() } as any;
        }
      }
      if (!profile) return res.status(404).json({ error: "Tutor not found" });

      // parse date & step
      const dateStr = String(req.query.date ?? "");
      const day = parseDateParam(dateStr); // local midnight
      const step = Math.max(15, Math.min(240, parseInt(String(req.query.step ?? "60"), 10) || 60));

      const key = toDayKey(day);
      const dayAvail = profile.availability?.[key];
      if (!dayAvail || !dayAvail.isAvailable) return res.json({ slots: [] });

      const { h: sh, m: sm } = parseHHMM(dayAvail.startTime, "09:00");
      const { h: eh, m: em } = parseHHMM(dayAvail.endTime, "17:00");

      // fetch booked sessions for that day
      const sDay = startOfDay(day);
      const eDay = endOfDay(day);

      // Avoid composite-index requirement: query by scheduledAt range, then filter tutorId in memory
      const bookedSnap = await fdb!
        .collection("tutoring_sessions")
        .where("scheduledAt", ">=", sDay)
        .where("scheduledAt", "<=", eDay)
        .get();

      const booked = bookedSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((s) => s.tutorId === profile.id)
        .filter((s) => {
          const st = (s.status || "scheduled") as string;
          // Only confirmed/active sessions block availability
          return st === "scheduled" || st === "in_progress";
        });

      const slots: Array<{ start: string; end: string; available: boolean; at: string }> = [];
      for (const s of generateSlots(
        `${sh.toString().padStart(2, "0")}:${sm.toString().padStart(2, "0")}`,
        `${eh.toString().padStart(2, "0")}:${em.toString().padStart(2, "0")}`,
        step
      )) {
        const slotStart = new Date(day);
        const [ssh, ssm] = s.start.split(":").map(Number);
        slotStart.setHours(ssh, ssm, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + step * 60_000);

        // past slots not available
        let available = slotStart > new Date();

        // conflict with existing sessions
        for (const b of booked) {
          const bStart = new Date(coerceMillis(b.scheduledAt));
          const dur = Number(b.duration ?? step);
          const bEnd = new Date(bStart.getTime() + dur * 60_000);
          if (overlaps(slotStart, slotEnd, bStart, bEnd)) {
            available = false;
            break;
          }
        }

        slots.push({
          start: s.start,
          end: s.end,
          available,
          at: slotStart.toISOString(),
        });
      }

      res.json({ slots });
    } catch (e: any) {
      console.error("availability error:", e);
      res.status(500).json({ error: e?.message || "Availability error" });
    }
  });

  // === ADMIN ===
  app.get("/api/admin/admins", requireUser, requireAdmin, async (_req, res) => {
    try {
      const snap = await fdb!.collection("users").where("role", "==", "admin").get();
      res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error fetching admin users:", error);
      res.status(500).json({ message: "Failed to fetch admin users", fieldErrors: {} });
    }
  });

  app.delete("/api/admin/admins/:userId", requireUser, requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const currentUser = req.user!;
      if (userId === currentUser.id)
        return res.status(400).json({ message: "You cannot delete your own admin account", fieldErrors: {} });

      const target = await getDoc<any>("users", userId);
      if (!target) return res.status(404).json({ message: "User not found", fieldErrors: {} });
      if (target.role !== "admin") return res.status(400).json({ message: "User is not an admin", fieldErrors: {} });

      await fdb!.collection("users").doc(userId).delete();
      res.json({ message: "Admin user deleted successfully" });
    } catch (error) {
      console.error("Error deleting admin user:", error);
      res.status(500).json({ message: "Failed to delete admin user", fieldErrors: {} });
    }
  });

  // Admin analytics endpoint
  app.get("/api/admin/analytics", requireUser, requireAdmin, async (req, res) => {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Get date range from query parameters
      const fromDateParam = req.query.fromDate as string | undefined;
      const toDateParam = req.query.toDate as string | undefined;
      const fromDate = fromDateParam ? new Date(fromDateParam) : undefined;
      const toDate = toDateParam ? new Date(toDateParam) : undefined;

      // Helper to check if a date is in range
      const isInDateRange = (dateValue: any): boolean => {
        if (!fromDate && !toDate) return true;
        const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
        if (fromDate && date < fromDate) return false;
        if (toDate && date > toDate) return false;
        return true;
      };

      // Get all users with timestamps
      const usersSnap = await fdb!.collection("users").get();
      let users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // Filter users by date range
      if (fromDate || toDate) {
        users = users.filter(u => isInDateRange(u.createdAt));
      }

      // Get all sessions
      const sessionsSnap = await fdb!.collection("tutoring_sessions").get();
      let sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      // Filter sessions by date range (using createdAt or scheduledAt)
      if (fromDate || toDate) {
        sessions = sessions.filter(s => isInDateRange(s.createdAt || s.scheduledAt));
      }

      // Get all tutor profiles for subjects
      const tutorProfiles = await listCollection<any>("tutor_profiles");

      // Calculate user growth (last 30 days)
      const userGrowth: { date: string; students: number; tutors: number }[] = [];
      for (let i = 29; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];

        const studentsCount = users.filter(u => {
          if (u.role !== 'student') return false;
          const createdAt = u.createdAt?.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
          return createdAt <= date;
        }).length;

        const tutorsCount = users.filter(u => {
          if (u.role !== 'tutor') return false;
          const createdAt = u.createdAt?.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
          return createdAt <= date;
        }).length;

        userGrowth.push({ date: dateStr, students: studentsCount, tutors: tutorsCount });
      }

      // Session statistics
      const sessionStats = {
        completed: sessions.filter(s => s.status === 'completed').length,
        scheduled: sessions.filter(s => s.status === 'scheduled').length,
        pending: sessions.filter(s => s.status === 'pending').length,
        cancelled: sessions.filter(s => s.status === 'cancelled').length,
        inProgress: sessions.filter(s => s.status === 'in-progress').length,
      };

      // Get all subjects and count sessions per subject
      const subjectsSnap = await fdb!.collection("subjects").get();
      const subjects = subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const subjectStats = subjects.map(subject => {
        const count = sessions.filter(s => s.subjectId === subject.id).length;
        return {
          name: subject.name,
          sessions: count,
        };
      }).filter(s => s.sessions > 0).sort((a, b) => b.sessions - a.sessions).slice(0, 8);

      // Calculate revenue (from completed sessions)
      const totalRevenue = sessions
        .filter(s => s.status === 'completed')
        .reduce((sum, s) => {
          const price = s.priceCents ? s.priceCents / 100 : (s.price || 0);
          return sum + price;
        }, 0);

      // Session completion rate
      const totalSessionsBooked = sessions.length;
      const completedSessions = sessionStats.completed;
      const completionRate = totalSessionsBooked > 0
        ? Math.round((completedSessions / totalSessionsBooked) * 100)
        : 0;

      // Recent activity (last 10 sessions)
      const recentSessions = sessions
        .sort((a, b) => {
          const aDate = a.scheduledAt?.toDate ? a.scheduledAt.toDate() : new Date(a.scheduledAt);
          const bDate = b.scheduledAt?.toDate ? b.scheduledAt.toDate() : new Date(b.scheduledAt);
          return bDate.getTime() - aDate.getTime();
        })
        .slice(0, 10);

      // Calculate tutor performance
      const tutorUsers = users.filter(u => u.role === 'tutor');
      const tutorUsersMap = new Map(tutorUsers.map(u => [u.id, u]));

      // Get all reviews for ratings
      const reviewsSnap = await fdb!.collection("tutor_reviews").get();
      const reviews = reviewsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

      const tutorPerformance = tutorProfiles
        .filter(tp => tp.isVerified && tutorUsersMap.has(tp.userId))
        .map(tutorProfile => {
          const tutorUser = tutorUsersMap.get(tutorProfile.userId);
          const tutorSessions = sessions.filter(s => s.tutorId === tutorProfile.id);
          const completedTutorSessions = tutorSessions.filter(s => s.status === 'completed');
          const tutorReviews = reviews.filter(r => r.tutorId === tutorProfile.id);

          const totalSessions = tutorSessions.length;
          const completedCount = completedTutorSessions.length;
          const completionRate = totalSessions > 0 ? Math.round((completedCount / totalSessions) * 100) : 0;

          const avgRating = tutorReviews.length > 0
            ? tutorReviews.reduce((sum, r) => sum + r.rating, 0) / tutorReviews.length
            : 0;

          const revenue = completedTutorSessions.reduce((sum, s) => {
            const price = s.priceCents ? s.priceCents / 100 : (s.price || 0);
            return sum + price;
          }, 0);

          return {
            tutorId: tutorProfile.id,
            userId: tutorProfile.userId,
            name: tutorUser ? `${tutorUser.firstName || ''} ${tutorUser.lastName || ''}`.trim() : 'Unknown',
            profileImageUrl: tutorUser?.profileImageUrl || null,
            totalSessions,
            completedSessions: completedCount,
            completionRate,
            averageRating: Math.round(avgRating * 10) / 10,
            totalReviews: tutorReviews.length,
            revenue: Math.round(revenue * 100) / 100,
          };
        })
        .filter(t => t.totalSessions > 0); // Only tutors with at least 1 session

      // Calculate normalized scores for overall ranking
      // Find max values for normalization
      const maxRevenue = Math.max(...tutorPerformance.map(t => t.revenue), 1);
      const maxSessions = Math.max(...tutorPerformance.map(t => t.totalSessions), 1);
      const maxReviewCount = Math.max(...tutorPerformance.map(t => t.totalReviews), 1);

      const rankedTutors = tutorPerformance.map(t => {
        // Only rank tutors with at least one completed session
        if (t.completedSessions === 0) {
          return { ...t, score: 0 };
        }

        // Normalize values to 0-100 scale
        const normalizedSessions = (t.totalSessions / maxSessions) * 100;
        const normalizedRevenue = (t.revenue / maxRevenue) * 100;
        const normalizedCompletion = t.completionRate; // Already 0-100

        // Rating score: combine average rating with review count confidence
        // More reviews = higher confidence, boost the score
        const ratingScore = (t.averageRating / 5) * 100; // 0-100 from rating
        const reviewConfidence = (t.totalReviews / maxReviewCount) * 100; // 0-100 from review count
        // Weighted combination: 70% rating quality, 30% review volume
        const normalizedRating = (ratingScore * 0.7) + (reviewConfidence * 0.3);

        // Final weighted score based on real-world tutor performance:
        // - Sessions (40%) - student demand & activity
        // - Ratings (40%) - quality & student satisfaction with review confidence
        // - Completion (20%) - reliability (moderate weight as cancellations often student-caused)
        const score = (
          (normalizedSessions * 0.40) +
          (normalizedRating * 0.40) +
          (normalizedCompletion * 0.20)
        );

        return { ...t, score: Math.round(score * 100) / 100 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // Top 10 tutors

      res.json({
        userGrowth,
        sessionStats,
        subjectStats,
        overview: {
          totalStudents: users.filter(u => u.role === 'student').length,
          totalTutors: users.filter(u => u.role === 'tutor').length,
          verifiedTutors: tutorProfiles.filter(t => t.isVerified).length,
          totalSessions: totalSessionsBooked,
          completedSessions,
          completionRate,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
        },
        recentActivity: recentSessions.map(s => ({
          id: s.id,
          status: s.status,
          scheduledAt: s.scheduledAt?.toDate ? s.scheduledAt.toDate().toISOString() : s.scheduledAt,
        })),
        topPerformingTutors: rankedTutors,
      });
    } catch (error) {
      console.error("Error fetching admin analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics", fieldErrors: {} });
    }
  });

  app.get("/api/admin/students", requireUser, requireAdmin, async (_req, res) => {
    try {
      const snap = await fdb!.collection("users").where("role", "==", "student").get();
      res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students", fieldErrors: {} });
    }
  });

  // Get student details with sessions
  app.get("/api/admin/students/:userId/details", requireUser, requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;

      // Get student user data
      const studentDoc = await fdb!.collection("users").doc(userId).get();
      if (!studentDoc.exists) {
        return res.status(404).json({ message: "Student not found", fieldErrors: {} });
      }

      const student = { id: studentDoc.id, ...studentDoc.data() };

      // Get student's sessions
      const sessionsSnap = await fdb!.collection("tutoring_sessions")
        .where("studentId", "==", userId)
        .orderBy("scheduledAt", "desc")
        .limit(50)
        .get();

      const sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Get unique tutor and subject IDs
      const tutorIds = new Set<string>();
      const subjectIds = new Set<string>();
      sessions.forEach((s: any) => {
        if (s.tutorId) tutorIds.add(s.tutorId);
        if (s.subjectId) subjectIds.add(s.subjectId);
      });

      // Batch load tutors and subjects
      const tutorsMap = await batchLoadMap<any>("tutor_profiles", Array.from(tutorIds));
      const subjectsMap = await batchLoadMap<any>("subjects", Array.from(subjectIds));

      // Get tutor user data
      const tutorUserIds = Array.from(tutorsMap.values()).map((t: any) => t.userId).filter(Boolean);
      const tutorUsersMap = await batchLoadMap<any>("users", tutorUserIds);

      // Enrich sessions with tutor and subject data
      const enrichedSessions = sessions.map((s: any) => {
        const tutorProfile = s.tutorId ? tutorsMap.get(s.tutorId) : null;
        const tutorUser = tutorProfile?.userId ? tutorUsersMap.get(tutorProfile.userId) : null;

        return {
          ...s,
          tutor: tutorProfile ? {
            ...tutorProfile,
            user: tutorUser,
          } : null,
          subject: s.subjectId ? subjectsMap.get(s.subjectId) : null,
        };
      });

      res.json({
        student,
        sessions: enrichedSessions,
        stats: {
          totalSessions: sessions.length,
          completedSessions: sessions.filter((s: any) => s.status === 'completed').length,
          upcomingSessions: sessions.filter((s: any) => s.status === 'scheduled').length,
          cancelledSessions: sessions.filter((s: any) => s.status === 'cancelled').length,
        },
      });
    } catch (error) {
      console.error("Error fetching student details:", error);
      res.status(500).json({ message: "Failed to fetch student details", fieldErrors: {} });
    }
  });

  // Get tutor sessions
  app.get("/api/admin/tutors/:userId/sessions", requireUser, requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;

      // Get tutor profile
      const tutorProfileSnap = await fdb!.collection("tutor_profiles")
        .where("userId", "==", userId)
        .limit(1)
        .get();

      if (tutorProfileSnap.empty) {
        return res.status(404).json({ message: "Tutor profile not found", fieldErrors: {} });
      }

      const tutorProfile = tutorProfileSnap.docs[0];

      // Get tutor's sessions
      const sessionsSnap = await fdb!.collection("tutoring_sessions")
        .where("tutorId", "==", tutorProfile.id)
        .get();

      // Sort in memory to avoid needing a composite index
      const sortedDocs = sessionsSnap.docs.sort((a, b) => {
        const aTime = coerceMillis(a.get("scheduledAt"));
        const bTime = coerceMillis(b.get("scheduledAt"));
        return bTime - aTime; // descending
      }).slice(0, 50); // limit to 50

      const sessions = sortedDocs.map(d => ({ id: d.id, ...d.data() }));

      // Get unique student and subject IDs
      const studentIds = new Set<string>();
      const subjectIds = new Set<string>();
      sessions.forEach((s: any) => {
        if (s.studentId) studentIds.add(s.studentId);
        if (s.subjectId) subjectIds.add(s.subjectId);
      });

      // Batch load students and subjects
      const studentsMap = await batchLoadMap<any>("users", Array.from(studentIds));
      const subjectsMap = await batchLoadMap<any>("subjects", Array.from(subjectIds));

      // Enrich sessions
      const enrichedSessions = sessions.map((s: any) => ({
        ...s,
        student: s.studentId ? studentsMap.get(s.studentId) : null,
        subject: s.subjectId ? subjectsMap.get(s.subjectId) : null,
      }));

      res.json({
        sessions: enrichedSessions,
        stats: {
          totalSessions: sessions.length,
          completedSessions: sessions.filter((s: any) => s.status === 'completed').length,
          upcomingSessions: sessions.filter((s: any) => s.status === 'scheduled').length,
          cancelledSessions: sessions.filter((s: any) => s.status === 'cancelled').length,
        },
      });
    } catch (error) {
      console.error("Error fetching tutor sessions:", error);
      res.status(500).json({ message: "Failed to fetch tutor sessions", fieldErrors: {} });
    }
  });

  // Mark all notifications as read
  app.post("/api/admin/notifications/mark-all-read", requireUser, requireAdmin, async (req, res) => {
    try {
      // Get all unread admin notifications
      const unreadSnap = await fdb!.collection("notifications")
        .where("audience", "==", "admin")
        .where("isRead", "==", false)
        .get();

      // Batch update all to read
      const batch = fdb!.batch();
      unreadSnap.docs.forEach(doc => {
        batch.update(doc.ref, { isRead: true, readAt: now() });
      });

      await batch.commit();

      res.json({
        message: "All notifications marked as read",
        count: unreadSnap.size,
      });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ message: "Failed to mark notifications as read", fieldErrors: {} });
    }
  });

  app.get("/api/admin/tutors", requireUser, requireAdmin, async (_req, res) => {
    try {
      const profs = await listCollection<any>("tutor_profiles");
      const userIds = profs.map((p) => p.userId).filter(Boolean);
      const usersMap = await batchLoadMap<any>("users", userIds);
      const results = profs.map((p) => ({ profile: p, user: usersMap.get(p.userId) || null }));
      res.json(results);
    } catch (error) {
      console.error("Error fetching tutors:", error);
      res.status(500).json({ message: "Failed to fetch tutors", fieldErrors: {} });
    }
  });

  app.get("/api/admin/pending-tutors", requireUser, requireAdmin, async (_req, res) => {
    try {
      const profs = await listCollection<any>("tutor_profiles", [["isVerified", "==", false]]);

      if (profs.length === 0) {
        return res.json([]);
      }

      const userIds = profs.map((p) => p.userId).filter(Boolean);
      const tutorIds = profs.map((p) => p.id);

      // Load users and tutor_subjects
      const [usersMap, tsDocs] = await Promise.all([
        batchLoadMap<any>("users", userIds),
        (async () => {
          // fetch tutor_subjects in chunks of 10 for 'in' constraint
          const chunks: string[][] = [];
          for (let i = 0; i < tutorIds.length; i += 10) {
            chunks.push(tutorIds.slice(i, i + 10));
          }
          const acc: FirebaseFirestore.QueryDocumentSnapshot[] = [];
          for (const chunk of chunks) {
            const snap = await fdb!
              .collection("tutor_subjects")
              .where("tutorId", "in", chunk)
              .get();
            acc.push(...snap.docs);
          }
          return acc;
        })(),
      ]);

      // Build tutorId -> subjectIds map
      const tutorSubjectIds = new Map<string, string[]>();
      for (const doc of tsDocs) {
        const tid = doc.get("tutorId");
        const sid = doc.get("subjectId");
        if (!tutorSubjectIds.has(tid)) tutorSubjectIds.set(tid, []);
        tutorSubjectIds.get(tid)!.push(sid);
      }

      // Batch load all subjects
      const allSubjectIds = Array.from(new Set(tsDocs.map((d) => d.get("subjectId"))));
      const subjectsMap = await batchLoadMap<any>("subjects", allSubjectIds);

      // Enrich profiles with user and subjects
      const results = profs.map((p) => {
        const subjectIds = tutorSubjectIds.get(p.id) || [];
        const subjects = subjectIds
          .map((sid) => (subjectsMap.get(sid) ? { id: sid, ...subjectsMap.get(sid)! } : null))
          .filter(Boolean);

        return {
          profile: p,
          user: usersMap.get(p.userId) || null,
          subjects,
        };
      });

      res.json(results);
    } catch (error) {
      console.error("Error fetching pending tutors:", error);
      res.status(500).json({ message: "Failed to fetch pending tutors", fieldErrors: {} });
    }
  });

  app.delete("/api/admin/students/:userId", requireUser, requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const target = await getDoc<any>("users", userId);
      if (!target) return res.status(404).json({ message: "User not found", fieldErrors: {} });
      if (target.role !== "student") return res.status(400).json({ message: "User is not a student", fieldErrors: {} });
      await fdb!.collection("users").doc(userId).delete();
      res.json({ message: "Student deleted successfully" });
    } catch (error) {
      console.error("Error deleting student:", error);
      res.status(500).json({ message: "Failed to delete student", fieldErrors: {} });
    }
  });

  app.delete("/api/admin/tutors/:userId", requireUser, requireAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const target = await getDoc<any>("users", userId);
      if (!target) return res.status(404).json({ message: "User not found", fieldErrors: {} });
      if (target.role !== "tutor") return res.status(400).json({ message: "User is not a tutor", fieldErrors: {} });
      await fdb!.collection("users").doc(userId).delete();
      res.json({ message: "Tutor deleted successfully" });
    } catch (error) {
      console.error("Error deleting tutor:", error);
      res.status(500).json({ message: "Failed to delete tutor", fieldErrors: {} });
    }
  });

  app.put("/api/tutors/:tutorId/verify", requireUser, requireAdmin, async (req, res) => {
    try {
      const { tutorId } = req.params;
      const ref = fdb!.collection("tutor_profiles").doc(tutorId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ message: "Tutor profile not found", fieldErrors: {} });
      await ref.set({ isVerified: true, isActive: true, updatedAt: now() }, { merge: true });

      // Invalidate tutors and stats cache since verification affects both
      cachedTutors = null;
      cachedStats = null;
      console.log("[Cache] Tutors and Stats cache invalidated");

      res.json({ message: "Tutor verified successfully" });
    } catch (error) {
      console.error("Error verifying tutor:", error);
      res.status(500).json({ message: "Failed to verify tutor", fieldErrors: {} });
    }
  });

  // === ADMIN NOTIFICATIONS ===
  app.get("/api/admin/notifications", requireUser, requireAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = (page - 1) * limit;

      const q = fdb!
        .collection("notifications")
        .where("audience", "==", "admin")
        .orderBy("createdAt", "desc")
        .offset(offset)
        .limit(limit);

      const snap = await q.get();
      const allNotifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json(allNotifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications", fieldErrors: {} });
    }
  });

  app.post("/api/admin/notifications/:id/read", requireUser, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const ref = fdb!.collection("notifications").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ message: "Notification not found", fieldErrors: {} });
      await ref.set({ isRead: true }, { merge: true });
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read", fieldErrors: {} });
    }
  });

  // === USER NOTIFICATIONS (for avatar badge & tutor alerts) ===
  app.get("/api/notifications", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const page = parseInt((req.query.page as string) || "1");
      const limit = Math.min(parseInt((req.query.limit as string) || "30"), 50);
      const offset = (page - 1) * limit;

      const q = fdb!
        .collection("notifications")
        .where("audience", "==", "user")
        .where("userId", "==", user.id)
        .orderBy("createdAt", "desc")
        .offset(offset)
        .limit(limit);

      const snap = await q.get();
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json(list);
    } catch (error) {
      // fallback (no "audience" equality)
      try {
        const user = req.user!;
        const page = parseInt((req.query.page as string) || "1");
        const limit = Math.min(parseInt((req.query.limit as string) || "30"), 50);
        const offset = (page - 1) * limit;

        const q = fdb!
          .collection("notifications")
          .where("userId", "==", user.id)
          .orderBy("createdAt", "desc")
          .offset(offset)
          .limit(limit);

        const snap = await q.get();
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        res.json(list);
      } catch (e2) {
        console.error("Error fetching user notifications:", e2);
        res.status(500).json({ message: "Failed to fetch notifications", fieldErrors: {} });
      }
    }
  });

  app.get("/api/notifications/unread-count", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const agg = await fdb!
        .collection("notifications")
        .where("userId", "==", user.id)
        .where("isRead", "==", false)
        .count()
        .get();
      res.json({ unread: agg.data().count || 0 });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ message: "Failed to fetch unread count", fieldErrors: {} });
    }
  });

  app.post("/api/notifications/:id/read", requireUser, async (req, res) => {
    try {
      const { id } = req.params;
      const user = req.user!;
      const ref = fdb!.collection("notifications").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ message: "Notification not found", fieldErrors: {} });
      const data = snap.data() as any;
      if (data.userId && data.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Not authorized", fieldErrors: {} });
      }
      await ref.set({ isRead: true }, { merge: true });
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read", fieldErrors: {} });
    }
  });

// === TUTORS LISTING (with subjects + reviews) ===
app.get("/api/tutors", async (_req, res) => {
  try {
    // Check cache first
    const now = Date.now();
    if (cachedTutors && (now - cachedTutorsFetchedAt) < TUTORS_TTL_MS) {
      console.log("[/api/tutors] Serving from cache");
      return res.json(cachedTutors);
    }

    // Cache miss - fetch from Firestore
    console.log("[/api/tutors] Fetching from Firestore");
    const profs = await listCollection<any>("tutor_profiles", [
      ["isActive", "==", true],
      ["isVerified", "==", true],
    ]);

    if (profs.length === 0) {
      cachedTutors = [];
      cachedTutorsFetchedAt = now;
      return res.json([]);
    }

    const userIds = profs.map((p) => p.userId).filter(Boolean);
    const tutorIds = profs.map((p) => p.id);

    // Load users and tutor_subjects
    const [mapUsers, tsDocs] = await Promise.all([
      batchLoadMap<any>("users", userIds),
      (async () => {
        // fetch tutor_subjects in chunks of 10 for 'in' constraint
        const chunks: string[][] = [];
        for (let i = 0; i < tutorIds.length; i += 10) {
          chunks.push(tutorIds.slice(i, i + 10));
        }
        const acc: FirebaseFirestore.QueryDocumentSnapshot[] = [];
        for (const chunk of chunks) {
          const snap = await fdb!
            .collection("tutor_subjects")
            .where("tutorId", "in", chunk)
            .get();
          acc.push(...snap.docs);
        }
        return acc;
      })(),
    ]);

    // Map tutor -> subject ids
    const byTutor = new Map<string, string[]>();
    for (const d of tsDocs) {
      const tId = d.get("tutorId") as string;
      const sId = d.get("subjectId") as string;
      if (!byTutor.has(tId)) byTutor.set(tId, []);
      byTutor.get(tId)!.push(sId);
    }

    const subjectIds = Array.from(
      new Set(tsDocs.map((d) => d.get("subjectId") as string).filter(Boolean))
    );
    const mapSubjects = await batchLoadMap<any>("subjects", subjectIds);

    // ---- NEW: load reviews and compute average + count per tutor ----
    const ratingStats = new Map<string, { sum: number; count: number }>();

    if (tutorIds.length > 0) {
      const reviewChunks: string[][] = [];
      for (let i = 0; i < tutorIds.length; i += 10) {
        reviewChunks.push(tutorIds.slice(i, i + 10));
      }

      for (const chunk of reviewChunks) {
        const reviewSnap = await fdb!
          .collection("reviews")
          .where("tutorId", "in", chunk)
          .get();

        for (const rDoc of reviewSnap.docs) {
          const r = rDoc.data() as any;
          const tid = String(r.tutorId || "");
          const rating = Number(r.rating ?? 0);
          if (!tid || !rating) continue;

          const prev = ratingStats.get(tid) || { sum: 0, count: 0 };
          prev.sum += rating;
          prev.count += 1;
          ratingStats.set(tid, prev);
        }
      }
    }

    const tutorsWithSubjects = profs.map((p) => {
      const sids = byTutor.get(p.id) || [];
      const subjects = sids
        .map((sid) =>
          mapSubjects.get(sid) ? { id: sid, ...mapSubjects.get(sid)! } : null
        )
        .filter(Boolean);

      const stats = ratingStats.get(p.id);
      const reviewCount = stats?.count ?? 0;
      const averageRating =
        stats && stats.count > 0 ? stats.sum / stats.count : 0;

      return {
        ...p,
        user: mapUsers.get(p.userId) || null,
        subjects,
        // fields the TutorCard tries to read
        averageRating,
        reviewCount,
        totalRating: averageRating,
        totalReviews: reviewCount,
      };
    });

    // Filter out tutors with critical missing data (incomplete profiles)
    const filteredTutors = tutorsWithSubjects.filter((tutor) => {
      // Check critical requirements for public visibility
      // CRITICAL: pricePerHour, subjects, availability
      const hasPrice = tutor.pricePerHour && tutor.pricePerHour > 0;
      const hasSubjects = tutor.subjects && tutor.subjects.length > 0;

      // Check if tutor has at least one day with availability enabled
      const hasAvailability = tutor.availability &&
                             typeof tutor.availability === 'object' &&
                             Object.values(tutor.availability).some(
                               (day: any) => day?.isAvailable === true
                             );

      // Debug logging to see which criteria are failing
      if (!hasPrice || !hasSubjects || !hasAvailability) {
        console.log(`[Tutor Filter] Blocking tutor ${tutor.user?.firstName || tutor.name || tutor.id}:`, {
          hasPrice,
          hasSubjects,
          hasAvailability,
          availabilityData: tutor.availability
        });
      }

      // Only show tutors that meet all critical requirements
      return hasPrice && hasSubjects && hasAvailability;
    });

    console.log(`[Tutor Filter] Total tutors: ${tutorsWithSubjects.length}, Visible: ${filteredTutors.length}, Hidden: ${tutorsWithSubjects.length - filteredTutors.length}`);

    // Update cache
    cachedTutors = filteredTutors;
    cachedTutorsFetchedAt = now;

    res.json(filteredTutors);
  } catch (error) {
    console.error("Error fetching tutors:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch tutors", fieldErrors: {} });
  }
});

// === AI-POWERED TUTOR RECOMMENDATIONS ===
// GET /api/tutors/recommended
app.get("/api/tutors/recommended", async (req, res) => {
  try {
    // Extract query parameters
    const subjectId = req.query.subjectId as string | undefined;
    const gradeLevel = req.query.gradeLevel as string | undefined;
    const maxBudget = req.query.maxBudget ? parseInt(req.query.maxBudget as string) : undefined;
    const preferredDays = req.query.preferredDays
      ? (req.query.preferredDays as string).split(",")
      : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

    // Get all active and verified tutors
    const profs = await listCollection<any>("tutor_profiles", [
      ["isActive", "==", true],
      ["isVerified", "==", true],
    ]);

    if (profs.length === 0) {
      return res.json([]);
    }

    // Filter by subject if specified
    let tutorIds = profs.map((p) => p.id);

    if (subjectId) {
      const tutorSubjectSnap = await fdb!
        .collection("tutor_subjects")
        .where("subjectId", "==", subjectId)
        .get();

      const tutorsForSubject = new Set(
        tutorSubjectSnap.docs.map((d) => d.get("tutorId") as string)
      );

      tutorIds = tutorIds.filter((id) => tutorsForSubject.has(id));
    }

    if (tutorIds.length === 0) {
      return res.json([]);
    }

    // Initialize ranking service and rank tutors
    const rankingService = new TutorRankingService(fdb!);
    const rankings = await rankingService.rankTutors(tutorIds, {
      subjectId,
      gradeLevel,
      maxBudget,
      preferredDays,
    });

    // Take top N tutors
    const topRankings = rankings.slice(0, limit);

    // Fetch full tutor data for top ranked tutors
    const topTutorIds = topRankings.map((r) => r.tutorId);
    const topProfiles = profs.filter((p) => topTutorIds.includes(p.id));

    // Load user data
    const userIds = topProfiles.map((p) => p.userId).filter(Boolean);
    const mapUsers = await batchLoadMap<any>("users", userIds);

    // Load subjects for each tutor
    const tsDocs = await (async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < topTutorIds.length; i += 10) {
        chunks.push(topTutorIds.slice(i, i + 10));
      }
      const acc: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const chunk of chunks) {
        const snap = await fdb!
          .collection("tutor_subjects")
          .where("tutorId", "in", chunk)
          .get();
        acc.push(...snap.docs);
      }
      return acc;
    })();

    const byTutor = new Map<string, string[]>();
    for (const d of tsDocs) {
      const tId = d.get("tutorId") as string;
      const sId = d.get("subjectId") as string;
      if (!byTutor.has(tId)) byTutor.set(tId, []);
      byTutor.get(tId)!.push(sId);
    }

    const subjectIds = Array.from(
      new Set(tsDocs.map((d) => d.get("subjectId") as string).filter(Boolean))
    );
    const mapSubjects = await batchLoadMap<any>("subjects", subjectIds);

    // Load reviews for ratings
    const ratingStats = new Map<string, { sum: number; count: number }>();
    if (topTutorIds.length > 0) {
      const reviewChunks: string[][] = [];
      for (let i = 0; i < topTutorIds.length; i += 10) {
        reviewChunks.push(topTutorIds.slice(i, i + 10));
      }

      for (const chunk of reviewChunks) {
        const reviewSnap = await fdb!
          .collection("reviews")
          .where("tutorId", "in", chunk)
          .get();

        for (const rDoc of reviewSnap.docs) {
          const r = rDoc.data() as any;
          const tid = String(r.tutorId || "");
          const rating = Number(r.rating ?? 0);
          if (!tid || !rating) continue;

          const prev = ratingStats.get(tid) || { sum: 0, count: 0 };
          prev.sum += rating;
          prev.count += 1;
          ratingStats.set(tid, prev);
        }
      }
    }

    // Build response with AI ranking data
    const tutorsWithRankings = topProfiles.map((p) => {
      const ranking = topRankings.find((r) => r.tutorId === p.id);
      const sids = byTutor.get(p.id) || [];
      const subjects = sids
        .map((sid) =>
          mapSubjects.get(sid) ? { id: sid, ...mapSubjects.get(sid)! } : null
        )
        .filter(Boolean);

      const stats = ratingStats.get(p.id);
      const reviewCount = stats?.count ?? 0;
      const averageRating =
        stats && stats.count > 0 ? stats.sum / stats.count : 0;

      return {
        ...p,
        user: mapUsers.get(p.userId) || null,
        subjects,
        averageRating,
        reviewCount,
        totalRating: averageRating,
        totalReviews: reviewCount,
        // AI ranking data
        aiScore: ranking?.score,
        aiBreakdown: ranking?.breakdown,
        aiReasoning: ranking?.reasoning,
      };
    });

    // Sort by AI score (should already be sorted, but ensure)
    tutorsWithRankings.sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));

    res.json(tutorsWithRankings);
  } catch (error) {
    console.error("Error fetching recommended tutors:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch tutor recommendations", fieldErrors: {} });
  }
});


  // === SINGLE TUTOR (for public profile page) ===
  // === PUBLIC SINGLE TUTOR BY ID OR USERID ===
  // GET /api/tutors/:id
// === PUBLIC SINGLE TUTOR BY ID OR USERID ===
// GET /api/tutors/:id
app.get("/api/tutors/:id", async (req, res) => {
  try {
    const rawId = req.params.id;

    // 1) try as tutor_profiles document id
    let profile = await getDoc<any>("tutor_profiles", rawId);

    // 2) if not found, try as userId
    if (!profile) {
      const byUser = await fdb!
        .collection("tutor_profiles")
        .where("userId", "==", rawId)
        .limit(1)
        .get();

      if (!byUser.empty) {
        profile = {
          id: byUser.docs[0].id,
          ...byUser.docs[0].data(),
        } as any;
      }
    }

    if (!profile) {
      return res
        .status(404)
        .json({ message: "Tutor profile not found", fieldErrors: {} });
    }

    const profileId = profile.id as string;

    // join user
    const joinedUser = await getDoc<any>("users", profile.userId);

    // join subjects
    const tsSnap = await fdb!
      .collection("tutor_subjects")
      .where("tutorId", "==", profileId)
      .get();
    const subjectIds = tsSnap.docs.map((d) => d.get("subjectId"));
    let subjects: any[] = [];
    if (subjectIds.length) {
      const map = await batchLoadMap<any>("subjects", subjectIds);
      subjects = subjectIds
        .map((sid) =>
          map.get(sid) ? { id: sid, ...map.get(sid)! } : null
        )
        .filter(Boolean) as any[];
    }

    // ---- NEW: aggregate reviews for this tutor ----
    const reviewsSnap = await fdb!
      .collection("reviews")
      .where("tutorId", "==", profileId)
      .get();

    let sum = 0;
    let count = 0;
    for (const d of reviewsSnap.docs) {
      const data = d.data() as any;
      const rating = Number(data.rating ?? 0);
      if (!rating) continue;
      sum += rating;
      count += 1;
    }
    const averageRating = count > 0 ? sum / count : 0;
    const reviewCount = count;

    res.json({
      ...profile,
      user: joinedUser,
      subjects,
      averageRating,
      reviewCount,
      totalRating: averageRating,
      totalReviews: reviewCount,
    });
  } catch (error) {
    console.error("Error fetching tutor by id:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch tutor", fieldErrors: {} });
  }
});


  // === SESSIONS (FAST JOIN) ===
  app.get("/api/sessions", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const formatted = await fetchSessionsForUser(user, limit);
      res.set("Cache-Control", "private, max-age=5");
      res.json(formatted);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions", fieldErrors: {} });
    }
  });

  // Compatibility: student-specific endpoint
  app.get("/api/my-sessions", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      if (user.role !== "student") {
        return res.status(403).json({ message: "Only students can view these sessions", fieldErrors: {} });
      }
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const formatted = await fetchSessionsForUser(user, limit);
      res.set("Cache-Control", "private, max-age=5");
      res.json(formatted);
    } catch (error) {
      console.error("Error fetching student sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions", fieldErrors: {} });
    }
  });

  // Compatibility: tutor-specific endpoint
  app.get("/api/tutor/sessions", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      if (user.role !== "tutor") {
        return res.status(403).json({ message: "Only tutors can view these sessions", fieldErrors: {} });
      }
      const limit = Math.min(parseInt((req.query.limit as string) || "100"), 200);
      const formatted = await fetchSessionsForUser(user, limit);
      res.set("Cache-Control", "private, max-age=5");
      res.json(formatted);
    } catch (error) {
      console.error("Error fetching tutor sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions", fieldErrors: {} });
    }
  });

  // === CREATE SESSION with availability + conflict validation ===
  app.post("/api/sessions", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      if (user.role !== "student") {
        return res.status(403).json({ message: "Only students can book sessions", fieldErrors: {} });
      }

      console.log("📝 Session booking request:", {
        studentId: user.id,
        tutorId: req.body.tutorId,
        scheduledAt: req.body.scheduledAt,
        duration: req.body.duration,
      });

      // Parse and normalize inputs
      const body = insertSessionSchema.parse({
        ...req.body,
        studentId: user.id,
        status: "pending", // Start as pending
      });

      // scheduledAt -> Date
      const sesStart = body.scheduledAt instanceof Date ? body.scheduledAt : new Date(body.scheduledAt as string);
      if (isNaN(sesStart.getTime())) {
        return res.status(400).json({ message: "Invalid scheduledAt", fieldErrors: {} });
      }

      // duration -> minutes
      const duration = Number(
        body.duration ?? (req.body?.durationMinutes ?? body.durationMinutes) ?? 60
      );
      const sesEnd = new Date(sesStart.getTime() + duration * 60_000);

      // Resolve tutor profile
      let tutorProfile = await getDoc<any>("tutor_profiles", body.tutorId);
      if (!tutorProfile) {
        const byUser = await fdb!
          .collection("tutor_profiles")
          .where("userId", "==", body.tutorId)
          .limit(1)
          .get();
        if (!byUser.empty) {
          tutorProfile = { id: byUser.docs[0].id, ...byUser.docs[0].data() } as any;
        }
      }
      if (!tutorProfile) {
        return res.status(404).json({ message: "Tutor profile not found", fieldErrors: {} });
      }
      const resolvedTutorId = tutorProfile.id as string;

      console.log("✅ Tutor profile resolved:", {
        tutorProfileId: resolvedTutorId,
        tutorUserId: tutorProfile.userId,
      });

      // 1) Day availability window
      const key = toDayKey(sesStart);
      const dayAvail = tutorProfile.availability?.[key];
      if (!dayAvail || !dayAvail.isAvailable) {
        return res.status(409).json({ message: "Tutor not available this day", fieldErrors: {} });
      }
      const { h: sh, m: sm } = parseHHMM(dayAvail.startTime, "09:00");
      const { h: eh, m: em } = parseHHMM(dayAvail.endTime, "17:00");

      const dayStart = new Date(sesStart);
      dayStart.setHours(sh, sm, 0, 0);
      const dayEnd = new Date(sesStart);
      dayEnd.setHours(eh, em, 0, 0);

      if (!(sesStart >= dayStart && sesEnd <= dayEnd)) {
        return res.status(409).json({ message: "Outside tutor availability window", fieldErrors: {} });
      }

      // 2) Conflict check - Check only confirmed sessions (scheduled)
      const sDay = startOfDay(sesStart);
      const eDay = endOfDay(sesStart);
      const bookedSnap = await fdb!
        .collection("tutoring_sessions")
        .where("tutorId", "==", resolvedTutorId)
        .where("scheduledAt", ">=", sDay)
        .where("scheduledAt", "<=", eDay)
        .get();

      for (const d of bookedSnap.docs) {
        const s = { id: d.id, ...(d.data() as any) };
        const st = (s.status || "scheduled") as string;
        // Only block if session is scheduled (confirmed)
        if (st !== "scheduled") continue;

        const bStart = new Date(coerceMillis(s.scheduledAt));
        const bEnd = new Date(bStart.getTime() + Number(s.duration ?? 60) * 60_000);
        if (overlaps(sesStart, sesEnd, bStart, bEnd)) {
          return res.status(409).json({ message: "Time slot already booked", fieldErrors: {} });
        }
      }

      // 3) Create session with PENDING status
      const docRef = await fdb!.collection("tutoring_sessions").add({
        tutorId: resolvedTutorId,
        studentId: user.id,
        subjectId: body.subjectId,
        scheduledAt: sesStart,
        duration,
        timeSlots: req.body.timeSlots || [], // Store individual time slots
        status: "pending", // Start as pending
        notes: req.body.notes || "",
        meetingLink: req.body.meetingLink || null,
        priceCents: req.body.priceCents || 0,
        createdAt: now(),
        updatedAt: now(),
      });

      console.log("✅ Session created:", docRef.id);

      // 4) Notify tutor
      const tutorUserId = tutorProfile.userId;
      const studentName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "A student";

      if (tutorUserId) {
        try {
          const notifRef = await fdb!.collection("notifications").add({
            type: "SESSION_REQUESTED",
            title: "New session request",
            body: `${studentName} requested a session on ${sesStart.toLocaleDateString()} at ${sesStart.toLocaleTimeString()}`,
            userId: tutorUserId,
            audience: "user",
            data: {
              sessionId: docRef.id,
              tutorId: resolvedTutorId,
              studentId: user.id,
              subjectId: body.subjectId,
            },
            isRead: false,
            createdAt: now(),
          });

          console.log("✅ Notification created:", notifRef.id, "for tutor user:", tutorUserId);
        } catch (notifError) {
          console.error("❌ Failed to create notification:", notifError);
        }
      } else {
        console.warn("⚠️ No tutorUserId found, notification not created");
      }

      const snap = await docRef.get();
      const sessionData = { id: snap.id, ...snap.data() };

      console.log("✅ Session booking complete:", sessionData);

      res.json(sessionData);
    } catch (error) {
      console.error("❌ Error creating session:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", fieldErrors: error.flatten().fieldErrors });
      }
      res.status(500).json({ message: "Failed to create session", fieldErrors: {} });
    }
  });

  app.put("/api/sessions/:id", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const sessionId = req.params.id;
      const { status } = req.body as { status: string };

      const validStatuses = ["pending", "scheduled", "in_progress", "completed", "cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid session status", fieldErrors: {} });
      }

      const ref = fdb!.collection("tutoring_sessions").doc(sessionId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ message: "Session not found", fieldErrors: {} });
      }
      const session = { id: snap.id, ...(snap.data() as any) } as any;

      // Auth: only student, owning tutor, or admin can update
      if (user.role === "student" && session.studentId !== user.id) {
        return res.status(403).json({ message: "Not authorized to update this session", fieldErrors: {} });
      }

      if (user.role === "tutor") {
        const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
        const tutorProfile = profSnap.empty ? null : ({ id: profSnap.docs[0].id, ...profSnap.docs[0].data() } as any);
        if (!tutorProfile || session.tutorId !== tutorProfile.id) {
          return res.status(403).json({ message: "Not authorized to update this session", fieldErrors: {} });
        }
      }

      // If we are confirming the session, enforce conflict check
      if (status === "scheduled") {
        const sesStart = new Date(coerceMillis(session.scheduledAt));
        if (isNaN(sesStart.getTime())) {
          return res.status(400).json({ message: "Invalid session date", fieldErrors: {} });
        }
        const duration = Number(session.duration ?? 60);
        const sesEnd = new Date(sesStart.getTime() + duration * 60_000);

        const sDay = startOfDay(sesStart);
        const eDay = endOfDay(sesStart);

        const bookedSnap = await fdb!
          .collection("tutoring_sessions")
          .where("tutorId", "==", session.tutorId)
          .where("scheduledAt", ">=", sDay)
          .where("scheduledAt", "<=", eDay)
          .get();

        for (const d of bookedSnap.docs) {
          if (d.id === sessionId) continue; // ignore self
          const s = { id: d.id, ...(d.data() as any) };
          const st = (s.status || "scheduled") as string;
          if (st !== "scheduled") continue;

          const bStart = new Date(coerceMillis(s.scheduledAt));
          const bEnd = new Date(bStart.getTime() + Number(s.duration ?? 60) * 60_000);
          if (overlaps(sesStart, sesEnd, bStart, bEnd)) {
            return res.status(409).json({ message: "Time slot already booked", fieldErrors: {} });
          }
        }
      }

      await ref.set({ status, updatedAt: now() }, { merge: true });

      // Invalidate stats cache if session was completed
      if (status === "completed") {
        cachedStats = null;
        console.log("[Cache] Stats cache invalidated");
      }

      const updated = await ref.get();
      res.json({ id: updated.id, ...updated.data() });
    } catch (error) {
      console.error("Error updating session:", error);
      res.status(500).json({ message: "Failed to update session", fieldErrors: {} });
    }
  });

  // === SESSION NOTES & AI SUMMARY ===
  app.put("/api/sessions/:id/tutor-notes", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const sessionId = req.params.id;
      const { tutorNotes } = req.body as { tutorNotes: string };

      if (!tutorNotes) {
        return res.status(400).json({ message: "Tutor notes are required", fieldErrors: {} });
      }

      const ref = fdb!.collection("tutoring_sessions").doc(sessionId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ message: "Session not found", fieldErrors: {} });
      }
      const session = { id: snap.id, ...(snap.data() as any) } as any;

      // Only the tutor can update notes
      if (user.role === "tutor") {
        const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
        const tutorProfile = profSnap.empty ? null : ({ id: profSnap.docs[0].id, ...profSnap.docs[0].data() } as any);
        if (!tutorProfile || session.tutorId !== tutorProfile.id) {
          return res.status(403).json({ message: "Not authorized to update notes for this session", fieldErrors: {} });
        }
      } else if (user.role !== "admin") {
        return res.status(403).json({ message: "Only tutors can update session notes", fieldErrors: {} });
      }

      await ref.set({ tutorNotes, updatedAt: now() }, { merge: true });
      const updated = await ref.get();
      res.json({ id: updated.id, ...updated.data() });
    } catch (error) {
      console.error("Error updating tutor notes:", error);
      res.status(500).json({ message: "Failed to update tutor notes", fieldErrors: {} });
    }
  });

  app.post("/api/sessions/:id/generate-summary", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const sessionId = req.params.id;

      const ref = fdb!.collection("tutoring_sessions").doc(sessionId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ message: "Session not found", fieldErrors: {} });
      }
      const session = { id: snap.id, ...(snap.data() as any) } as any;

      // Only the tutor can generate summary
      if (user.role === "tutor") {
        const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
        const tutorProfile = profSnap.empty ? null : ({ id: profSnap.docs[0].id, ...profSnap.docs[0].data() } as any);
        if (!tutorProfile || session.tutorId !== tutorProfile.id) {
          return res.status(403).json({ message: "Not authorized to generate summary for this session", fieldErrors: {} });
        }
      } else if (user.role !== "admin") {
        return res.status(403).json({ message: "Only tutors can generate session summaries", fieldErrors: {} });
      }

      // Check if tutor notes exist
      if (!session.tutorNotes || session.tutorNotes.trim() === "") {
        return res.status(400).json({ message: "Tutor notes are required to generate a summary", fieldErrors: {} });
      }

      // Import the AI summary generator
      const { generateLessonSummary } = await import("./ai-summary");

      // Fetch additional context for better summary
      const subjectSnap = await fdb!.collection("subjects").doc(session.subjectId).get();
      const subject = subjectSnap.exists ? subjectSnap.data()?.name : undefined;

      const studentSnap = await fdb!.collection("users").doc(session.studentId).get();
      const studentName = studentSnap.exists ? `${studentSnap.data()?.firstName} ${studentSnap.data()?.lastName}` : undefined;

      // Generate the AI summary
      const aiSummary = await generateLessonSummary({
        tutorNotes: session.tutorNotes,
        subject,
        studentName,
        duration: session.duration,
      });

      // Save the summary to the session
      await ref.set(
        {
          aiSummary: {
            ...aiSummary,
            generatedAt: now(),
          },
          updatedAt: now(),
        },
        { merge: true }
      );

      // Create or update Study Buddy conversation with the AI summary
      let studyBuddyConvId: string | null = null;
      try {
        // Create a study buddy conversation for this session
        const conversationRef = fdb!.collection("study_buddy_conversations").doc();
        studyBuddyConvId = conversationRef.id;

        // Format the AI summary as initial conversation context
        const summaryMessage = `📚 **Lesson Report for ${subject || "your session"}**

**What You Learned:**
${aiSummary.whatWasLearned}

**Your Strengths:**
${aiSummary.strengths}

**Areas for Improvement:**
${aiSummary.mistakes}

**Practice Tasks:**
${aiSummary.practiceTasks}

---

I'm here to help you understand the concepts better and practice! Feel free to ask me questions about anything from your lesson.`;

        await conversationRef.set({
          conversationId: studyBuddyConvId,
          userId: session.studentId,
          sessionId: sessionId,
          title: `${subject || "Session"} Review`,
          summary: `Review conversation for ${subject || "session"} on ${new Date().toLocaleDateString()}`,
          createdAt: now(),
          updatedAt: now(),
          messageCount: 1,
        });

        // Add the AI summary as the first message in the conversation
        await fdb!.collection("study_buddy_messages").add({
          conversationId: studyBuddyConvId,
          userId: session.studentId,
          role: "assistant",
          content: summaryMessage,
          timestamp: now(),
          metadata: {
            sessionId: sessionId,
            generatedFromSummary: true,
          },
        });

        console.log(`Study Buddy conversation created for session ${sessionId}`);
      } catch (studyBuddyError) {
        console.error("Error creating study buddy conversation (non-critical):", studyBuddyError);
      }

      // Automatically generate quiz after summary is created
      let quizGenerationError: string | null = null;
      try {
        const { generateSessionQuiz } = await import("./ai-quiz");

        console.log(`Starting quiz generation for session ${sessionId}...`);

        // Generate the quiz
        const quizData = await generateSessionQuiz({
          aiSummary,
          subject,
          studentName,
        });

        console.log(`Quiz data generated, saving to Firestore...`);

        // Save the quiz to Firestore
        const quizRef = fdb!.collection("session_quizzes").doc();
        await quizRef.set({
          sessionId,
          ...quizData,
          createdAt: now(),
          aiGenerated: true,
        });

        // Update session with quiz reference
        await ref.set(
          {
            quizId: quizRef.id,
            studyBuddyConversationId: studyBuddyConvId,
            updatedAt: now(),
          },
          { merge: true }
        );

        console.log(`✅ Quiz auto-generated successfully for session ${sessionId} (Quiz ID: ${quizRef.id})`);
      } catch (quizError: any) {
        // Log error but don't fail the summary generation
        console.error("❌ Error auto-generating quiz:", quizError);
        console.error("Quiz error details:", {
          message: quizError.message,
          stack: quizError.stack,
        });
        quizGenerationError = quizError.message || "Failed to generate quiz";

        // Still save the study buddy conversation ID if it exists
        if (studyBuddyConvId) {
          await ref.set(
            {
              studyBuddyConversationId: studyBuddyConvId,
              updatedAt: now(),
            },
            { merge: true }
          );
        }
      }

      // Send notification to student about new lesson report
      try {
        const notificationBody = quizGenerationError
          ? `Your tutor has created a lesson report for your ${subject || "session"}. Check out your Study Buddy to review!`
          : `Your tutor has created a lesson report for your ${subject || "session"}. View the report, take the improvement quiz, and chat with your Study Buddy!`;

        await fdb!.collection("notifications").add({
          userId: session.studentId,
          audience: "user",
          type: "LESSON_REPORT_READY",
          title: "New Lesson Report Available",
          body: notificationBody,
          isRead: false,
          sessionId,
          studyBuddyConversationId: studyBuddyConvId,
          createdAt: now(),
        });
        console.log(`Notification sent to student ${session.studentId}`);
      } catch (notifError) {
        console.error("Error sending notification (non-critical):", notifError);
      }

      const updated = await ref.get();
      const responseData: any = { id: updated.id, ...updated.data() };

      // Include quiz generation status for better UX
      if (quizGenerationError) {
        responseData.warnings = [
          {
            type: "quiz_generation_failed",
            message: `Quiz generation failed: ${quizGenerationError}. The summary and study buddy were created successfully.`,
          },
        ];
      }

      if (studyBuddyConvId) {
        responseData.studyBuddyConversationId = studyBuddyConvId;
      }

      res.json(responseData);
   } catch (error: any) {
  console.error("Error generating AI summary:", error);

  const msg = String(error?.message ?? "");
  const isOverloaded =
    msg.includes("model is overloaded") ||
    msg.includes("503 Service Unavailable");

  if (isOverloaded) {
    return res
      .status(503)
      .json({
        message: "AI service is temporarily busy. Please try again in a few seconds.",
        fieldErrors: {},
      });
  }

  if (msg.toLowerCase().includes("api key")) {
    return res
      .status(500)
      .json({
        message: "AI configuration error. Please contact the administrator.",
        fieldErrors: {},
      });
  }

  if (msg.toLowerCase().includes("quota")) {
    return res
      .status(429)
      .json({
        message: "AI quota exceeded. Please try again later.",
        fieldErrors: {},
      });
  }

  res.status(500).json({
    message: msg || "Failed to generate summary. Please try again.",
    fieldErrors: {},
  });
}
});

  // === SESSION QUIZZES ===

  // Generate quiz from session summary
  app.post("/api/sessions/:id/generate-quiz", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const sessionId = req.params.id;

      const sessionRef = fdb!.collection("tutoring_sessions").doc(sessionId);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) {
        return res.status(404).json({ message: "Session not found", fieldErrors: {} });
      }
      const session = { id: sessionSnap.id, ...(sessionSnap.data() as any) } as any;

      // Only tutors or admins can generate quizzes
      if (user.role === "tutor") {
        const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
        const tutorProfile = profSnap.empty ? null : ({ id: profSnap.docs[0].id, ...profSnap.docs[0].data() } as any);
        if (!tutorProfile || session.tutorId !== tutorProfile.id) {
          return res.status(403).json({ message: "Not authorized to generate quiz for this session", fieldErrors: {} });
        }
      } else if (user.role !== "admin") {
        return res.status(403).json({ message: "Only tutors can generate session quizzes", fieldErrors: {} });
      }

      // Check if AI summary exists
      if (!session.aiSummary) {
        return res.status(400).json({ message: "AI summary is required to generate a quiz. Please generate the summary first.", fieldErrors: {} });
      }

      // Import the AI quiz generator
      const { generateSessionQuiz } = await import("./ai-quiz");

      // Fetch additional context
      const subjectSnap = await fdb!.collection("subjects").doc(session.subjectId).get();
      const subject = subjectSnap.exists ? subjectSnap.data()?.name : undefined;

      const studentSnap = await fdb!.collection("users").doc(session.studentId).get();
      const studentName = studentSnap.exists ? `${studentSnap.data()?.firstName} ${studentSnap.data()?.lastName}` : undefined;

      // Generate the quiz
      const quizData = await generateSessionQuiz({
        aiSummary: session.aiSummary,
        subject,
        studentName,
      });

      // Save the quiz to Firestore
      const quizRef = fdb!.collection("session_quizzes").doc();
      await quizRef.set({
        sessionId,
        ...quizData,
        createdAt: now(),
        aiGenerated: true,
      });

      // Update session with quiz reference
      await sessionRef.set(
        {
          quizId: quizRef.id,
          updatedAt: now(),
        },
        { merge: true }
      );

      const quiz = await quizRef.get();
      res.json({ id: quiz.id, ...quiz.data() });
    } catch (error: any) {
      console.error("Error generating quiz:", error);

      const msg = String(error?.message ?? "");
      const isOverloaded =
        msg.includes("model is overloaded") ||
        msg.includes("503 Service Unavailable");

      if (isOverloaded) {
        return res
          .status(503)
          .json({
            message: "AI service is temporarily busy. Please try again in a few seconds.",
            fieldErrors: {},
          });
      }

      if (msg.toLowerCase().includes("api key")) {
        return res
          .status(500)
          .json({
            message: "AI configuration error. Please contact the administrator.",
            fieldErrors: {},
          });
      }

      if (msg.toLowerCase().includes("quota")) {
        return res
          .status(429)
          .json({
            message: "AI quota exceeded. Please try again later.",
            fieldErrors: {},
          });
      }

      res.status(500).json({
        message: msg || "Failed to generate quiz. Please try again.",
        fieldErrors: {},
      });
    }
  });

  // Get quiz for a session
  app.get("/api/sessions/:id/quiz", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const sessionId = req.params.id;

      const sessionRef = fdb!.collection("tutoring_sessions").doc(sessionId);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) {
        return res.status(404).json({ message: "Session not found", fieldErrors: {} });
      }
      const session = { id: sessionSnap.id, ...(sessionSnap.data() as any) } as any;

      // Verify user is the student or tutor of this session
      let isAuthorized = false;
      if (user.role === "student" && session.studentId === user.id) {
        isAuthorized = true;
      } else if (user.role === "tutor") {
        const profSnap = await fdb!.collection("tutor_profiles").where("userId", "==", user.id).limit(1).get();
        const tutorProfile = profSnap.empty ? null : ({ id: profSnap.docs[0].id, ...profSnap.docs[0].data() } as any);
        if (tutorProfile && session.tutorId === tutorProfile.id) {
          isAuthorized = true;
        }
      } else if (user.role === "admin") {
        isAuthorized = true;
      }

      if (!isAuthorized) {
        return res.status(403).json({ message: "Not authorized to view this quiz", fieldErrors: {} });
      }

      // Get quiz by quizId from session or by sessionId query
      let quizSnap;
      if (session.quizId) {
        quizSnap = await fdb!.collection("session_quizzes").doc(session.quizId).get();
      } else {
        const quizzes = await fdb!.collection("session_quizzes").where("sessionId", "==", sessionId).limit(1).get();
        quizSnap = quizzes.empty ? null : quizzes.docs[0];
      }

      if (!quizSnap || !quizSnap.exists) {
        return res.status(404).json({ message: "Quiz not found for this session", fieldErrors: {} });
      }

      const quiz = { id: quizSnap.id, ...quizSnap.data() };

      // Get student's attempt if they're a student
      if (user.role === "student") {
        const attemptSnap = await fdb!.collection("quiz_attempts")
          .where("quizId", "==", quizSnap.id)
          .where("studentId", "==", user.id)
          .limit(1)
          .get();

        if (!attemptSnap.empty) {
          const attempt = { id: attemptSnap.docs[0].id, ...attemptSnap.docs[0].data() };
          res.json({ quiz, attempt });
          return;
        }
      }

      res.json({ quiz, attempt: null });
    } catch (error) {
      console.error("Error fetching quiz:", error);
      res.status(500).json({ message: "Failed to fetch quiz", fieldErrors: {} });
    }
  });

  // Submit quiz answers
  app.post("/api/sessions/:id/quiz/submit", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const sessionId = req.params.id;
      const { answers } = req.body; // answers: { questionIndex: selectedAnswer }

      if (user.role !== "student") {
        return res.status(403).json({ message: "Only students can submit quiz answers", fieldErrors: {} });
      }

      const sessionRef = fdb!.collection("tutoring_sessions").doc(sessionId);
      const sessionSnap = await sessionRef.get();
      if (!sessionSnap.exists) {
        return res.status(404).json({ message: "Session not found", fieldErrors: {} });
      }
      const session = { id: sessionSnap.id, ...(sessionSnap.data() as any) } as any;

      // Verify student is authorized
      if (session.studentId !== user.id) {
        return res.status(403).json({ message: "Not authorized to submit answers for this quiz", fieldErrors: {} });
      }

      // Get quiz
      let quizSnap;
      if (session.quizId) {
        quizSnap = await fdb!.collection("session_quizzes").doc(session.quizId).get();
      } else {
        const quizzes = await fdb!.collection("session_quizzes").where("sessionId", "==", sessionId).limit(1).get();
        quizSnap = quizzes.empty ? null : quizzes.docs[0];
      }

      if (!quizSnap || !quizSnap.exists) {
        return res.status(404).json({ message: "Quiz not found", fieldErrors: {} });
      }

      const quiz = { id: quizSnap.id, ...quizSnap.data() } as any;

      // Calculate score
      let correctCount = 0;
      const totalQuestions = quiz.questions.length;
      const detailedResults: any[] = [];

      quiz.questions.forEach((question: any, index: number) => {
        const studentAnswer = answers[index];
        const isCorrect = studentAnswer === question.correctAnswer;
        if (isCorrect) correctCount++;

        detailedResults.push({
          questionIndex: index,
          question: question.question,
          studentAnswer,
          correctAnswer: question.correctAnswer,
          isCorrect,
          explanation: question.explanation,
          topic: question.topic,
        });
      });

      const score = Math.round((correctCount / totalQuestions) * 100);

      // Check if attempt already exists
      const existingAttempt = await fdb!.collection("quiz_attempts")
        .where("quizId", "==", quizSnap.id)
        .where("studentId", "==", user.id)
        .limit(1)
        .get();

      let attemptRef;
      if (!existingAttempt.empty) {
        // Update existing attempt
        attemptRef = existingAttempt.docs[0].ref;
        await attemptRef.update({
          answers,
          score,
          correctCount,
          totalQuestions,
          detailedResults,
          completedAt: now(),
          updatedAt: now(),
        });
      } else {
        // Create new attempt
        attemptRef = fdb!.collection("quiz_attempts").doc();
        await attemptRef.set({
          quizId: quizSnap.id,
          sessionId,
          studentId: user.id,
          answers,
          score,
          correctCount,
          totalQuestions,
          detailedResults,
          completedAt: now(),
          createdAt: now(),
        });
      }

      const attempt = await attemptRef.get();
      res.json({
        id: attempt.id,
        ...attempt.data(),
        message: `Quiz completed! You scored ${score}% (${correctCount}/${totalQuestions} correct)`
      });
    } catch (error) {
      console.error("Error submitting quiz:", error);
      res.status(500).json({ message: "Failed to submit quiz", fieldErrors: {} });
    }
  });

  // === REVIEWS ===
  app.get("/api/reviews/:tutorId", async (req, res) => {
    try {
      const { tutorId } = req.params;
      const snap = await fdb!
        .collection("reviews")
        .where("tutorId", "==", tutorId)
        .orderBy("createdAt", "desc")
        .get();
      const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      const studentIds = Array.from(new Set(raw.map((r) => r.studentId).filter(Boolean)));
      const mapStudents = await batchLoadMap<any>("users", studentIds);
      const formatted = raw.map((r) => ({ ...r, student: mapStudents.get(r.studentId) || null }));
      res.json(formatted);
    } catch (error) {
      console.error("Error fetching reviews:", error);
      res.status(500).json({ message: "Failed to fetch reviews", fieldErrors: {} });
    }
  });

  app.post("/api/reviews", requireUser, async (req, res) => {
    try {
      const me = req.user!;
      if (me.role !== "student") {
        return res.status(403).json({
          message: "Only students can submit reviews",
          fieldErrors: {},
        });
      }

      const { tutorId, rating, comment } = createReviewSchema.parse(req.body);

      // Resolve tutor profile id (allow passing either tutor_profile.id or tutor userId)
      let tutorProfile = await getDoc<any>("tutor_profiles", tutorId);
      if (!tutorProfile) {
        const byUser = await fdb!
          .collection("tutor_profiles")
          .where("userId", "==", tutorId)
          .limit(1)
          .get();
        if (!byUser.empty) {
          tutorProfile = {
            id: byUser.docs[0].id,
            ...byUser.docs[0].data(),
          } as any;
        }
      }

      if (!tutorProfile) {
        return res.status(404).json({
          message: "Tutor profile not found",
          fieldErrors: {},
        });
      }

      const resolvedTutorId = tutorProfile.id as string;

      // Ensure at least one COMPLETED session between this student and this tutor
      const completedSnap = await fdb!
        .collection("tutoring_sessions")
        .where("tutorId", "==", resolvedTutorId)
        .where("studentId", "==", me.id)
        .where("status", "==", "completed")
        .limit(1)
        .get();

      if (completedSnap.empty) {
        return res.status(403).json({
          message: "You can only review tutors you have completed a session with",
          fieldErrors: {},
        });
      }

      // Enforce one review per student/tutor
      const existingSnap = await fdb!
        .collection("reviews")
        .where("tutorId", "==", resolvedTutorId)
        .where("studentId", "==", me.id)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        return res.status(400).json({
          message: "You have already reviewed this tutor",
          fieldErrors: {},
        });
      }

      const docRef = await fdb!.collection("reviews").add({
        tutorId: resolvedTutorId,
        studentId: me.id,
        rating,
        comment: (comment ?? "").trim(),
        createdAt: now(),
        updatedAt: now(),
      });

      const snap = await docRef.get();
      const data = { id: snap.id, ...(snap.data() as any) };

      res.json(data);
    } catch (error) {
      console.error("Error creating review:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid review data",
          fieldErrors: error.flatten().fieldErrors,
        });
      }
      res.status(500).json({ message: "Failed to create review", fieldErrors: {} });
    }
  });

  // === MESSAGES (student <-> tutor chat) ===

  const createMessageSchema = z.object({
    receiverId: z.string(),
    content: z.string().min(1),
  });

  function isStudentTutorPair(me: AuthUser, other: { id: string; role?: string | null } | null) {
    if (!other) return false;
    const r1 = me.role ?? null;
    const r2 = other.role ?? null;
    return (
      (r1 === "student" && r2 === "tutor") ||
      (r1 === "tutor" && r2 === "student")
    );
  }

  // GET /api/messages/:otherUserId  -> full conversation between current user and :otherUserId
  app.get("/api/messages/:otherUserId", requireUser, async (req, res) => {
    try {
      const me = req.user!;
      const otherUserId = req.params.otherUserId;

      if (otherUserId === me.id) {
        return res.status(400).json({ message: "Cannot chat with yourself", fieldErrors: {} });
      }

      const otherUser = await getDoc<any>("users", otherUserId);
      if (!otherUser) {
        return res.status(404).json({ message: "User not found", fieldErrors: {} });
      }

      // Only allow student <-> tutor conversations
      if (!isStudentTutorPair(me, otherUser)) {
        return res.status(403).json({ message: "Chat is only allowed between students and tutors", fieldErrors: {} });
      }

      // Fetch both directions, then merge & sort in memory
      const col = fdb!.collection("messages");

      const [snap1, snap2] = await Promise.all([
        col.where("senderId", "==", me.id).where("receiverId", "==", otherUserId).get(),
        col.where("senderId", "==", otherUserId).where("receiverId", "==", me.id).get(),
      ]);

      const raw = [...snap1.docs, ...snap2.docs].map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      raw.sort((a, b) => coerceMillis(a.createdAt) - coerceMillis(b.createdAt));

      // Join sender / receiver for UI
      const mapUsers = await batchLoadMap<any>("users", [me.id, otherUserId]);
      const out = raw.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        receiverId: m.receiverId,
        content: m.content,
        read: !!m.read,
        createdAt: new Date(coerceMillis(m.createdAt)).toISOString(),
        sender: mapUsers.get(m.senderId) || null,
        receiver: mapUsers.get(m.receiverId) || null,
      }));

      res.json(out);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages", fieldErrors: {} });
    }
  });

  // POST /api/messages  -> send a new message
  app.post("/api/messages", requireUser, async (req, res) => {
    try {
      const me = req.user!;
      const body = createMessageSchema.parse(req.body);

      if (body.receiverId === me.id) {
        return res.status(400).json({ message: "Cannot send message to yourself", fieldErrors: {} });
      }

      const otherUser = await getDoc<any>("users", body.receiverId);
      if (!otherUser) {
        return res.status(404).json({ message: "Receiver not found", fieldErrors: {} });
      }

      // Only allow student <-> tutor conversations
      if (!isStudentTutorPair(me, otherUser)) {
        return res.status(403).json({ message: "Chat is only allowed between students and tutors", fieldErrors: {} });
      }

      const studentId = me.role === "student" ? me.id : (otherUser.id as string);
      const tutorId = me.role === "tutor" ? me.id : (otherUser.id as string);

      const docRef = await fdb!.collection("messages").add({
        senderId: me.id,
        receiverId: body.receiverId,
        content: body.content,
        studentId,
        tutorId,
        read: false,
        createdAt: now(),
      });

      const snap = await docRef.get();
      const data = { id: snap.id, ...(snap.data() as any) };

      const mapUsers = await batchLoadMap<any>("users", [me.id, body.receiverId]);
      const resp = {
        id: data.id,
        senderId: data.senderId,
        receiverId: data.receiverId,
        content: data.content,
        read: !!data.read,
        createdAt: new Date(coerceMillis(data.createdAt)).toISOString(),
        sender: mapUsers.get(data.senderId) || null,
        receiver: mapUsers.get(data.receiverId) || null,
      };

      // Create NEW_MESSAGE notification for the receiver
      try {
        const senderName = `${me.firstName || ""} ${me.lastName || ""}`.trim() || "Someone";
        await fdb!.collection("notifications").add({
          type: "NEW_MESSAGE",
          title: "New message",
          body: `You have a new message from ${senderName}`,
          userId: body.receiverId,
          audience: "user",
          isRead: false,
          createdAt: now(),
          data: {
            fromUserId: me.id,
          },
        });
      } catch (notifError) {
        console.error("Failed to create NEW_MESSAGE notification:", notifError);
      }

      res.json(resp);
    } catch (error) {
      console.error("Error creating message:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid message data", fieldErrors: error.flatten().fieldErrors });
      }
      res.status(500).json({ message: "Failed to send message", fieldErrors: {} });
    }
  });

  // PUT /api/messages/read/:otherUserId  -> mark all messages FROM otherUserId TO me as read
  app.put("/api/messages/read/:otherUserId", requireUser, async (req, res) => {
    try {
      const me = req.user!;
      const otherUserId = req.params.otherUserId;

      const otherUser = await getDoc<any>("users", otherUserId);
      if (!otherUser) {
        return res.status(404).json({ message: "User not found", fieldErrors: {} });
      }

      // Again: only student <-> tutor
      if (!isStudentTutorPair(me, otherUser)) {
        return res.status(403).json({ message: "Not allowed", fieldErrors: {} });
      }

      const snap = await fdb!
        .collection("messages")
        .where("senderId", "==", otherUserId)
        .where("receiverId", "==", me.id)
        .where("read", "==", false)
        .get();

      const batch = fdb!.batch();
      for (const d of snap.docs) {
        batch.update(d.ref, { read: true });
      }
      await batch.commit();

      // Also mark related NEW_MESSAGE notifications as read
      try {
        const notifSnap = await fdb!
          .collection("notifications")
          .where("userId", "==", me.id)
          .where("type", "==", "NEW_MESSAGE")
          .where("data.fromUserId", "==", otherUserId)
          .where("isRead", "==", false)
          .get();

        if (!notifSnap.empty) {
          const notifBatch = fdb!.batch();
          notifSnap.docs.forEach((d) => notifBatch.update(d.ref, { isRead: true }));
          await notifBatch.commit();
        }
      } catch (notifError) {
        console.error("Failed to mark NEW_MESSAGE notifications as read:", notifError);
      }

      res.json({ message: "Messages marked as read" });
    } catch (error) {
      console.error("Error marking messages as read:", error);
      res.status(500).json({ message: "Failed to mark messages as read", fieldErrors: {} });
    }
  });

  // === FAVORITES ===
  app.get("/api/favorites", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const snap = await fdb!.collection("favorites").where("userId", "==", user.id).get();
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      res.json(list.map((f) => f.tutorId));
    } catch (error) {
      console.error("Error fetching favorites:", error);
      res.status(500).json({ message: "Failed to fetch favorites", fieldErrors: {} });
    }
  });

  app.post("/api/favorites", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const validated = insertFavoriteSchema.parse({ userId: user.id, tutorId: req.body.tutorId });

      const existing = await fdb!
        .collection("favorites")
        .where("userId", "==", user.id)
        .where("tutorId", "==", validated.tutorId)
        .limit(1)
        .get();

      if (!existing.empty) return res.status(400).json({ message: "Tutor already in favorites", fieldErrors: {} });

      const favId = `${user.id}_${validated.tutorId}`;
      await fdb!.collection("favorites").doc(favId).set({ userId: user.id, tutorId: validated.tutorId, createdAt: now() });
      res.json({ message: "Tutor added to favorites" });
    } catch (error) {
      console.error("Error adding favorite:", error);
      res.status(500).json({ message: "Failed to add favorite", fieldErrors: {} });
    }
  });

  app.delete("/api/favorites/:tutorId", requireUser, async (req, res) => {
    try {
      const user = req.user!;
      const { tutorId } = req.params;

      const id = `${user.id}_${tutorId}`;
      const ref = fdb!.collection("favorites").doc(id);
      const snap = await ref.get();

      if (snap.exists) {
        await ref.delete();
      } else {
        const existing = await fdb!
          .collection("favorites")
          .where("userId", "==", user.id)
          .where("tutorId", "==", tutorId)
          .get();
        const batch = fdb!.batch();
        existing.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      res.json({ message: "Tutor removed from favorites" });
    } catch (error) {
      console.error("Error removing favorite:", error);
      res.status(500).json({ message: "Failed to remove favorite", fieldErrors: {} });
    }
  });

  // === SEED DATA (idempotent) ===
  app.post("/api/admin/seed-subjects-if-empty", requireUser, requireAdmin, async (_req, res) => {
    try {
      const existing = await fdb!.collection("subjects").limit(1).get();
      if (existing.empty) {
        const basic = [
          {
            id: "math",
            name: "Mathematics",
            description: "Math tutoring from basic arithmetic to advanced calculus",
            category: "STEM",
          },
          {
            id: "science",
            name: "Science",
            description: "Science tutoring including biology, chemistry, and physics",
            category: "STEM",
          },
          {
            id: "english",
            name: "English",
            description: "English language arts, writing, and literature",
            category: "Language Arts",
          },
          {
            id: "history",
            name: "History",
            description: "World history, US history, and social studies",
            category: "Social Studies",
          },
          {
            id: "computer-science",
            name: "Computer Science",
            description: "Programming, algorithms, and computer science concepts",
            category: "STEM",
          },
        ];
        const batch = fdb!.batch();
        basic.forEach((s) => {
          const ref = fdb!.collection("subjects").doc(s.id);
          batch.set(ref, { name: s.name, description: s.description, category: s.category, createdAt: now() });
        });
        await batch.commit();

        // Invalidate subjects cache
        cachedSubjects = null;
        console.log("[Cache] Subjects cache invalidated");

        res.json({ message: "Basic subjects seeded successfully" });
      } else {
        res.json({ message: "Subjects already exist" });
      }
    } catch (error) {
      console.error("Error seeding subjects:", error);
      res.status(500).json({ message: "Failed to seed subjects", fieldErrors: {} });
    }
  });

  app.get("/api/admin/tutors/pending", requireUser, requireAdmin, async (_req, res) => {
    try {
      if (!fdb) return res.status(500).json({ message: "Firestore not initialized" });

      const snapshot = await fdb
        .collection("tutor_profiles")
        .where("isVerified", "==", false)
        .orderBy("createdAt", "desc")
        .get();

      const pendingTutors: any[] = [];
      for (const doc of snapshot.docs) {
        const tutorData = doc.data();
        const userDoc = await fdb.collection("users").doc(tutorData.userId).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        pendingTutors.push({
          id: doc.id,
          ...tutorData,
          createdAt: tutorData.createdAt?.toDate?.() || tutorData.createdAt,
          updatedAt: tutorData.updatedAt?.toDate?.() || tutorData.updatedAt,
          user: {
            id: tutorData.userId,
            email: userData?.email || "",
            firstName: userData?.firstName || "",
            lastName: userData?.lastName || "",
            profileImageUrl: userData?.profileImageUrl || null,
          },
        });
      }

      res.json(pendingTutors);
    } catch (error: any) {
      console.error("Error fetching pending tutors:", error);
      res.status(500).json({ message: "Failed to fetch pending tutors", error: error.message });
    }
  });

  // Admin approves/rejects tutor
  app.post("/api/admin/tutors/:tutorId/approve", requireUser, requireAdmin, async (req, res) => {
    try {
      const { tutorId } = req.params;
      const { approved } = req.body; // true or false

      if (typeof approved !== "boolean") {
        return res.status(400).json({ message: "Invalid approval status" });
      }

      if (!fdb) {
        return res.status(500).json({ message: "Firestore not initialized" });
      }

      const tutorRef = fdb.collection("tutor_profiles").doc(tutorId);
      const tutorDoc = await tutorRef.get();

      if (!tutorDoc.exists) {
        return res.status(404).json({ message: "Tutor profile not found" });
      }

      // Update the tutor profile with approval status
      await tutorRef.update({
        isVerified: approved === true,
        isActive: approved === true,
        verificationStatus: approved ? "approved" : "rejected",
        verifiedAt: approved ? now() : null,
        updatedAt: now(),
      });

      res.json({
        message: approved ? "Tutor approved successfully" : "Tutor rejected",
        success: true,
        tutorId,
        approved,
      });
    } catch (error: any) {
      console.error("Error approving tutor:", error);
      res.status(500).json({ message: "Failed to update tutor status", error: error.message });
    }
  });

   // === CRON: AUTO-COMPLETE SESSIONS ===
  // POST /api/admin/cron/auto-complete-sessions
  // - In production: call regularly (e.g. via Cloud Scheduler) without "now" -> uses current time
  // - For testing: send { "now": "2025-11-16T20:00:00Z" } or ?now=... to simulate future time
  app.post("/api/admin/cron/auto-complete-sessions", requireUser, requireAdmin, async (req, res) => {
    try {
      const nowParam =
        (req.body && typeof req.body.now === "string" && req.body.now) ||
        (typeof req.query.now === "string" ? (req.query.now as string) : undefined);

      let cutoff: Date;
      if (nowParam) {
        const d = new Date(nowParam);
        if (isNaN(d.getTime())) {
          return res
            .status(400)
            .json({ message: "Invalid 'now' parameter", fieldErrors: {} });
        }
        cutoff = d;
      } else {
        cutoff = new Date();
      }

      const result = await autoCompleteSessions(cutoff);

      res.json({
        ...result,
        cutoff: cutoff.toISOString(),
      });
    } catch (error) {
      console.error("Error auto-completing sessions:", error);
      res.status(500).json({
        message: "Failed to auto-complete sessions",
        fieldErrors: {},
      });
    }
  });

  // === STUDY BUDDY ROUTES ===
  // Mount all Study Buddy API routes
  app.use("/api/study-buddy", studyBuddyRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
