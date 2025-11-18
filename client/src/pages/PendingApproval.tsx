// client/src/pages/PendingApproval.tsx
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Clock, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import { formatMoney } from "@/lib/currency";

/** Robust approval checker - SIMPLIFIED */
function isTutorApproved(profile: any): boolean {
  if (!profile) return false;

  // Primary check
  if (profile.isVerified === true) return true;

  // Fallback
  if (profile.verificationStatus === "approved") return true;

  return false;
}

export default function PendingApproval() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const hasShownApprovalToast = useRef(false);

  // Fetch profile with polling
  const {
    data: profile,
    isLoading: profileLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["/api/tutors/profile"],
    enabled: !!user && user.role === "tutor",
    queryFn: async () => {
      try {
        const data = await apiRequest("/api/tutors/profile", {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          },
          cache: 'no-store' as RequestCache
        });
        return data;
      } catch (error: any) {
        if (error.message.includes('404')) return null;
        throw error;
      }
    },
    select: (p: any) => {
      if (!p) return null;
      const approved = isTutorApproved(p);
      return { ...p, __approved: approved };
    },
    staleTime: 0,
    gcTime: 0, // Don't cache results
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (data) => {
      const approved = !!(data && (data as any).__approved);
      return approved ? false : 5000; // Poll every 5s until approved
    },
  });

  const approved = !!(profile as any)?.__approved;

  // Redirect non-tutors
  useEffect(() => {
    if (!authLoading && (!user || user.role !== "tutor")) {
      navigate("/", { replace: true });
    }
  }, [user, authLoading, navigate]);

  // Redirect to complete signup if no profile
  useEffect(() => {
    if (!profileLoading && user?.role === "tutor" && !profile) {
      navigate("/complete-signup", { replace: true });
    }
  }, [profileLoading, user?.role, profile, navigate]);

  // Redirect to dashboard once approved
  useEffect(() => {
    if (approved && !hasShownApprovalToast.current) {
      hasShownApprovalToast.current = true;

      toast({
        title: "🎉 Congratulations!",
        description: "Your tutor profile has been approved. Welcome to Daresni!",
        duration: 5000,
      });

      setTimeout(() => {
        navigate("/", { replace: true });
      }, 500);
    }
  }, [approved, navigate, toast]);

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading your profile...</p>
        </div>
      </div>
    );
  }

  // If approved, show success briefly before redirect
  if (approved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 p-4">
        <Card className="w-full max-w-2xl shadow-2xl border-green-200">
          <CardContent className="p-12 text-center">
            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
              <CheckCircle className="h-16 w-16 text-green-600" />
            </div>
            <h2 className="text-3xl font-bold text-green-800 mb-4">
              🎉 You're Approved!
            </h2>
            <p className="text-lg text-green-700 mb-6">
              Your tutor profile has been verified. Redirecting to your dashboard...
            </p>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main pending state
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-100 pt-16">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
          {/* Main Card */}
          <Card className="shadow-2xl border-2 border-orange-200">
            <CardHeader className="text-center bg-gradient-to-r from-orange-100 to-amber-100 pb-8">
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                <Clock className="h-12 w-12 text-orange-500 animate-pulse" />
              </div>
              <CardTitle className="text-3xl font-bold text-orange-900">
                Profile Under Review
              </CardTitle>
            </CardHeader>

            <CardContent className="p-8 space-y-6">
              {/* Status Message */}
              <div className="bg-white rounded-lg p-6 border-l-4 border-orange-500 shadow-sm">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="h-6 w-6 text-orange-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900 mb-2">
                      Thank You for Submitting Your Application!
                    </h3>
                    <p className="text-gray-700 leading-relaxed mb-3">
                      Our admin team is currently reviewing your tutor profile. This typically takes
                      <strong className="text-orange-600"> 1-2 business days</strong>.
                    </p>
                    <p className="text-gray-700 leading-relaxed">
                      You'll be redirected to your tutor dashboard automatically once approved,
                      and you'll receive a notification email.
                    </p>
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex justify-center">
                <Badge
                  variant="outline"
                  className="text-lg px-6 py-3 border-2 border-orange-400 text-orange-700 bg-orange-50"
                >
                  <Clock className="h-5 w-5 mr-2 animate-spin" />
                  Pending Verification
                </Badge>
              </div>

              {/* What Happens Next */}
              <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-4 flex items-center">
                  <CheckCircle className="h-5 w-5 mr-2" />
                  What Happens Next?
                </h4>
                <ol className="space-y-3 text-sm text-blue-800">
                  <li className="flex items-start">
                    <span className="bg-blue-200 text-blue-900 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-semibold">
                      1
                    </span>
                    <span>Admin reviews your profile, qualifications, and teaching experience</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-blue-200 text-blue-900 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-semibold">
                      2
                    </span>
                    <span>You receive email notification once approved</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-blue-200 text-blue-900 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-semibold">
                      3
                    </span>
                    <span>Your profile goes live and students can book sessions with you</span>
                  </li>
                  <li className="flex items-start">
                    <span className="bg-blue-200 text-blue-900 rounded-full w-6 h-6 flex items-center justify-center mr-3 flex-shrink-0 font-semibold">
                      4
                    </span>
                    <span>Start earning by teaching what you love!</span>
                  </li>
                </ol>
              </div>

              {/* Profile Summary */}
              {profile && (
                <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                  <h4 className="font-semibold text-gray-900 mb-4">Your Submitted Profile</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Name</p>
                      <p className="font-medium">
                        {user?.firstName} {user?.lastName}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Email</p>
                      <p className="font-medium">{user?.email}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Hourly Rate</p>
<p className="font-medium">
  {formatMoney((profile as any).hourlyRate ?? 0)}/hour
</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Submitted</p>
                      <p className="font-medium">
                        {(profile as any).createdAt ? new Date((profile as any).createdAt).toLocaleDateString() : "Recently"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="flex-1"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
                  {isFetching ? "Checking..." : "Check Status Now"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/profile-settings")}
                  className="flex-1"
                >
                  Edit Profile
                </Button>
              </div>

              {/* Auto-refresh notice */}
              <p className="text-center text-xs text-gray-500 flex items-center justify-center space-x-2">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>This page automatically checks for approval every 5 seconds</span>
              </p>

              {/* Contact Support */}
              <div className="text-center pt-4 border-t">
                <p className="text-sm text-gray-600">
                  Questions or concerns?{" "}
                  <a
                    href="mailto:support@daresni.com"
                    className="text-[#9B1B30] font-medium hover:underline"
                  >
                    Contact Support
                  </a>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Tips Card */}
          <Card className="mt-6 border-green-200 bg-green-50">
            <CardContent className="p-6">
              <h4 className="font-semibold text-green-900 mb-3 flex items-center">
                <CheckCircle className="h-5 w-5 mr-2" />
                Tips While You Wait
              </h4>
              <ul className="space-y-2 text-sm text-green-800">
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>Make sure your email is verified to receive notifications</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>Review our tutor guidelines to understand platform policies</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>Prepare your teaching materials and session plans</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">✓</span>
                  <span>Set up your availability calendar once approved</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
