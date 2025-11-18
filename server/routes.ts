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

      res.json({
        tutors: tutorsAgg.data().count || 0,
        students: studentsAgg.data().count || 0,
        sessions: completedAgg.data().count || 0,
      });
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

      const ref = fdb!.collection("users").doc(user.id);
      await ref.set({ ...updateData, updatedAt: now() }, { merge: true });

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
      const snap = await fdb.collection("subjects").orderBy("name").get();
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
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

      res.json({ profile: finalProfile, user: joinedUser, subjects });
    } catch (error) {
      console.error("Error creating tutor profile:", error);
      if (error instanceof z.ZodError) {
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

      res.json({ profile: { id: ref.id, ...updatedProfile.data() }, user: joinedUser, subjects });
    } catch (error) {
      console.error("Error updating tutor profile:", error);
      if (error instanceof z.ZodError) {
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

  app.get("/api/admin/students", requireUser, requireAdmin, async (_req, res) => {
    try {
      const snap = await fdb!.collection("users").where("role", "==", "student").get();
      res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Error fetching students:", error);
      res.status(500).json({ message: "Failed to fetch students", fieldErrors: {} });
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
      const userIds = profs.map((p) => p.userId).filter(Boolean);
      const usersMap = await batchLoadMap<any>("users", userIds);
      const results = profs.map((p) => ({ profile: p, user: usersMap.get(p.userId) || null }));
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
    const profs = await listCollection<any>("tutor_profiles", [
      ["isActive", "==", true],
      ["isVerified", "==", true],
    ]);

    if (profs.length === 0) return res.json([]);

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

    res.json(tutorsWithSubjects);
  } catch (error) {
    console.error("Error fetching tutors:", error);
    res
      .status(500)
      .json({ message: "Failed to fetch tutors", fieldErrors: {} });
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
      const studentName = studentSnap.exists ? studentSnap.data()?.name : undefined;

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

      const updated = await ref.get();
      res.json({ id: updated.id, ...updated.data() });
    } catch (error) {
      console.error("Error generating AI summary:", error);
      res.status(500).json({ message: "Failed to generate summary. Please try again.", fieldErrors: {} });
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

  const httpServer = createServer(app);
  return httpServer;
}
