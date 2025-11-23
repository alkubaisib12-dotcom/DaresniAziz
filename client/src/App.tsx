// client/src/App.tsx
import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";

import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/components/AuthProvider";

import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import StudentDashboard from "@/pages/StudentDashboard";
import TutorDashboard from "@/pages/TutorDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import TutorBrowse from "@/pages/TutorBrowse";
import TutorProfile from "@/pages/TutorProfile";
import CompleteSignup from "@/pages/CompleteSignup";
import CompleteTutorProfile from "@/pages/CompleteTutorProfile";
import AdminSetup from "@/pages/AdminSetup";
import MySessions from "@/pages/MySessions";
import ProfileSettings from "@/pages/ProfileSettings";
import PendingApproval from "@/pages/PendingApproval";
import NotificationsPage from "@/pages/NotificationsPage";
import StudentReports from "@/pages/StudentReports";
import Navbar from "@/components/Navbar";
import TutorEarningsReport from "@/pages/TutorEarningsReport";
import PreSessionMemoryGame from "@/components/PreSessionMemoryGame";
import GlobalStudyBuddy from "@/components/GlobalStudyBuddy";

/** Small helper to support legacy /dashboard -> / */
function DashboardAlias() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}

/** Narrow DTO so TS stops complaining when we probe fields */
type TutorProfileDTO =
  | {
      isVerified?: boolean;
      verificationStatus?: "pending" | "approved" | "rejected" | string;
      __approved?: boolean;
    }
  | null;

function AuthRouteGate() {
  const { user, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  // Tutor profile only for tutors
  const { data: tutorProfile, isLoading: tpLoading } = useQuery<TutorProfileDTO>({
    queryKey: ["/api/tutors/profile"],
    enabled: !!user && user.role === "tutor",
    retry: false,
    staleTime: 300000, // Optimized: 5 minutes instead of 0
  });

  useEffect(() => {
    if (isLoading) return;
    if (!user) return;

    const path = location;

    const at = (p: string) => path === p;
    const inEntry = at("/") || at("/dashboard") || at("/complete-signup");
    const onStudentArea = path.startsWith("/student-") || at("/student-dashboard");
    const onTutorArea = path.startsWith("/tutor-") || at("/tutor-dashboard");
    const onAdminArea = at("/admin") || at("/admin-setup");

    // ------- INCOMPLETE SIGNUP LOCKDOWN -------
    // Users with role: null MUST complete signup before accessing anything else
    if (user.role === null || user.role === undefined) {
      if (!at("/complete-signup")) {
        navigate("/complete-signup", { replace: true });
      }
      return; // Block all other navigation until role is chosen
    }

    // ------- ADMIN FIRST -------
    if (user.role === "admin") {
      // From entry / student / tutor / pending / complete-tutor-profile -> push to /admin
      if (
        inEntry ||
        onStudentArea ||
        onTutorArea ||
        at("/pending-approval") ||
        at("/complete-tutor-profile")
      ) {
        if (!at("/admin")) {
          navigate("/admin", { replace: true });
        }
      }
      // Admin is allowed to stay on /admin and /admin-setup
      return;
    }

    // Non-admin: block /admin and /admin-setup
    if (onAdminArea) {
      navigate("/", { replace: true });
      return;
    }

    // ------- STUDENT -------
    if (user.role === "student") {
      if (
        inEntry ||
        onTutorArea ||
        at("/pending-approval") ||
        at("/complete-tutor-profile")
      ) {
        if (!at("/student-dashboard")) {
          navigate("/student-dashboard", { replace: true });
        }
        return;
      }
      // Otherwise allow (tutor browse, tutor profile, profile settings, notifications, etc.)
      return;
    }

    // ------- TUTOR -------
    if (user.role === "tutor") {
      if (tpLoading) return;

      // If no tutor profile yet -> force to complete profile
      if (!tutorProfile) {
        if (!at("/complete-tutor-profile") && !at("/complete-signup")) {
          navigate("/complete-tutor-profile", { replace: true });
        }
        return;
      }

      const approved =
        tutorProfile?.isVerified === true ||
        tutorProfile?.verificationStatus === "approved" ||
        tutorProfile?.__approved === true;

      if (!approved) {
        // Pending tutors: block tutor area, entry, and student dashboards
        if (onTutorArea || inEntry || onStudentArea) {
          if (!at("/pending-approval")) {
            navigate("/pending-approval", { replace: true });
          }
        }
        // They can still browse tutors, open profile-settings, notifications, etc.
        return;
      }

      // Approved tutor: from entry / pending / complete-tutor-profile / student dashboard -> go to tutor dashboard
      if (
        inEntry ||
        at("/pending-approval") ||
        at("/complete-tutor-profile") ||
        onStudentArea
      ) {
        if (!at("/tutor-dashboard")) {
          navigate("/tutor-dashboard", { replace: true });
        }
        return;
      }

      // Otherwise allow navigation (including /tutor-earnings, etc.)
      return;
    }
  }, [user, isLoading, tutorProfile, tpLoading, location, navigate]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <AuthProvider>
          <Navbar />
          <AuthRouteGate />

          <Switch>
            <Route path="/" component={Landing} />
            <Route path="/dashboard" component={DashboardAlias} />

            {/* Public browsing */}
            <Route path="/tutors" component={TutorBrowse} />
            {/* New alias so old /tutor/:id links still work */}
            <Route path="/tutor/:id" component={TutorProfile} />
            <Route path="/tutors/:id" component={TutorProfile} />

            {/* Onboarding */}
            <Route path="/complete-signup" component={CompleteSignup} />
            <Route path="/complete-tutor-profile" component={CompleteTutorProfile} />
            <Route path="/pending-approval" component={PendingApproval} />

            {/* Signed-in areas */}
            <Route path="/student-dashboard" component={StudentDashboard} />
            <Route path="/tutor-dashboard" component={TutorDashboard} />
            <Route path="/tutor-earnings" component={TutorEarningsReport} />
            <Route path="/profile-settings" component={ProfileSettings} />
            <Route path="/my-sessions" component={MySessions} />
            <Route path="/student-reports" component={StudentReports} />
            <Route path="/notifications" component={NotificationsPage} />

            {/* Admin */}
            <Route path="/admin-setup" component={AdminSetup} />
            <Route path="/admin" component={AdminDashboard} />

            {/* 404 */}
            <Route component={NotFound} />
          </Switch>

          <Toaster />
          <PreSessionMemoryGame />
          <GlobalStudyBuddy />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
