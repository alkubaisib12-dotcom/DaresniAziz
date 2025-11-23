import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useQueryClient } from "@tanstack/react-query";

type Role = "student" | "tutor" | "admin" | null;

interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: Role;
}

interface MeResponse {
  user: User;
  hasTutorProfile: boolean;
  tutorProfile?: any;
}

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  user: User | null;
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  refreshUserData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  const getAuthToken = async (): Promise<string | null> => {
    if (!firebaseUser) return null;
    try {
      return await firebaseUser.getIdToken();
    } catch (error) {
      console.error("Error getting auth token:", error);
      return null;
    }
  };

  const fetchUserData = async (fbUser: FirebaseUser): Promise<void> => {
    try {
      const token = await fbUser.getIdToken();
      const response = await fetch("/api/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data: MeResponse = await response.json();
        setUser(data.user);
      } else {
        console.error("Failed to fetch user data:", response.statusText);
        setUser(null);
      }
    } catch (error) {
      console.error("Error fetching user data:", error);
      setUser(null);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);

      if (fbUser) {
        await fetchUserData(fbUser);
      } else {
        setUser(null);
        queryClient.clear();
      }

      setIsLoading(false);
    });

    return unsubscribe;
  }, [queryClient]);

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (url, options: RequestInit = {}) => {
      if (typeof url === "string" && url.startsWith("/api/") && firebaseUser) {
        try {
          // Get token (uses cached token if still valid)
          const token = await firebaseUser.getIdToken();
          options.headers = {
            ...options.headers,
            Authorization: `Bearer ${token}`,
          };

          // Make the request
          const response = await originalFetch(url, options);

          // If we get a 401, the token might be expired - try refreshing and retrying
          if (response.status === 401) {
            try {
              // Force refresh the token
              const freshToken = await firebaseUser.getIdToken(true);
              options.headers = {
                ...options.headers,
                Authorization: `Bearer ${freshToken}`,
              };
              // Retry the request with fresh token
              return await originalFetch(url, options);
            } catch (refreshError) {
              console.error("Error refreshing token:", refreshError);
              return response; // Return original 401 response
            }
          }

          return response;
        } catch (error) {
          console.error("Error getting auth token for API call:", error);
          return originalFetch(url, options);
        }
      }

      return originalFetch(url, options);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [firebaseUser]);

  const signInWithEmail = async (email: string, password: string) => {
    try {
      setIsLoading(true);
      const result = await signInWithEmailAndPassword(auth, email, password);
      const fbUser = result.user;
      setFirebaseUser(fbUser);
      await fetchUserData(fbUser);
    } catch (error) {
      console.error("Error signing in with email:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const signUpWithEmail = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string
  ) => {
    try {
      setIsLoading(true);
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const fbUser = result.user;

      await updateProfile(fbUser, {
        displayName: `${firstName} ${lastName}`.trim(),
      });

      // Make sure context has the fresh user immediately (reduces flicker)
      setFirebaseUser(fbUser);
      await fetchUserData(fbUser);
    } catch (error) {
      console.error("Error signing up with email:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      setUser(null);
      setFirebaseUser(null);
      queryClient.clear();
    } catch (error) {
      console.error("Error signing out:", error);
      throw error;
    }
  };

  const refreshUserData = async () => {
    if (firebaseUser) {
      await fetchUserData(firebaseUser);
    }
  };

  const value: AuthContextType = {
    firebaseUser,
    user,
    isLoading,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    getAuthToken,
    refreshUserData,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
