// server/firebase-admin.ts
import admin from "firebase-admin";
import type { Request, Response, NextFunction } from "express";

// -------------------------------------
// Initialize Firebase Admin (once)
// -------------------------------------
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && rawPrivateKey) {
    const privateKey = rawPrivateKey.replace(/\\n/g, "\n");

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
    console.log("Firebase Admin SDK initialized with service account");
  } else {
    // Fallback to application default (for local dev / GCP)
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log("Firebase Admin SDK initialized with applicationDefault credentials");
  }
}

// Single Firestore + Auth instances
export const db = admin.firestore();
export const auth = admin.auth();

// Optional aliases (in case other files import these)
export const fdb = db;
export const adminAuth = auth;

// Default export of admin instance
export default admin;

// -------------------------------------
// Types & Express augmentation
// -------------------------------------
export interface AuthUser {
  id: string;
  email: string;
  role: "student" | "tutor" | "admin" | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// -------------------------------------
// Middleware: requireUser (verifies ID token, upserts Firestore user)
// -------------------------------------
export const requireUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!auth || !db) {
      return res.status(500).json({
        message: "Firebase Admin SDK not configured",
        fieldErrors: {},
      });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authorization header missing or invalid",
        fieldErrors: {},
      });
    }

    const token = authHeader.slice("Bearer ".length);
    const decoded = await auth.verifyIdToken(token);

    const uid = decoded.uid;
    const email = decoded.email;
    const name = decoded.name || "";

    if (!email) {
      return res
        .status(401)
        .json({ message: "User email is required", fieldErrors: {} });
    }

    const [firstName, ...rest] = name.trim().split(" ").filter(Boolean);
    const lastName = rest.join(" ") || null;

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();

    let role: "student" | "tutor" | "admin" | null = null;
    let profileImageUrl: string | null = null;

    if (snap.exists) {
      const existing = snap.data() || {};
      role = (existing.role as any) ?? null;
      profileImageUrl = (existing.profileImageUrl as any) ?? null;

      await userRef.set(
        {
          email,
          firstName: firstName || existing.firstName || null,
          lastName: lastName ?? existing.lastName ?? null,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    } else {
      await userRef.set({
        email,
        firstName: firstName || null,
        lastName,
        role: null, // user will choose later
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const latest = (await userRef.get()).data() || {};
    role = (latest.role as any) ?? role ?? null;
    profileImageUrl = (latest.profileImageUrl as any) ?? profileImageUrl ?? null;

    req.user = {
      id: uid,
      email,
      role,
      firstName: (latest.firstName as any) ?? firstName ?? null,
      lastName: (latest.lastName as any) ?? lastName ?? null,
      profileImageUrl,
    };

    next();
  } catch (error) {
    console.error("Firebase token verification failed:", error);
    return res.status(401).json({
      message: "Invalid or expired token",
      fieldErrors: {},
    });
  }
};

// -------------------------------------
// Middleware: requireAdmin
// -------------------------------------
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ message: "Authentication required", fieldErrors: {} });
  }
  if (req.user.role !== "admin") {
    return res
      .status(403)
      .json({ message: "Admin access required", fieldErrors: {} });
  }
  next();
};
