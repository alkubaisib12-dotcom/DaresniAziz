import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  GraduationCap,
  CheckCircle,
  Phone,
  DollarSign,
  Award,
  FileText,
  AlertCircle,
} from "lucide-react";
import type { Subject } from "@shared/schema";

export default function CompleteSignup() {
  const { user, isLoading: authLoading, refreshUserData } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selectedRole, setSelectedRole] = useState<"student" | "tutor" | "">("");
  const [formData, setFormData] = useState({
    tutorData: {
      phone: "",
      bio: "",
      hourlyRate: "",
      experience: "",
      education: "",
      certifications: "",
      subjects: [] as string[],
      subjectPricing: {} as Record<string, string>,
      useSamePriceForAll: true,
    },
  });

  // Redirect if user is not logged in or already has a role
  useEffect(() => {
    if (authLoading) return;

    // Not signed in → go back home / login
    if (!user) {
      setLocation("/", { replace: true });
      return;
    }

    // Already has a role → they shouldn't be here
    if (user.role) {
      setLocation("/", { replace: true });
    }
  }, [authLoading, user, setLocation]);

  // Prevent back button navigation - lock user on this page until signup is complete
  useEffect(() => {
    if (authLoading || !user || user.role) return;

    // Push a new state to history to trap the user
    window.history.pushState(null, "", window.location.href);

    const handlePopState = (e: PopStateEvent) => {
      // Prevent navigation away - immediately push forward again
      window.history.pushState(null, "", window.location.href);

      toast({
        title: "Complete Your Profile",
        description: "Please complete your signup before navigating away.",
        variant: "destructive",
        duration: 3000,
      });
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [authLoading, user, toast]);

  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ["/api/subjects"],
    enabled: selectedRole === "tutor",
  });

  const completeSignupMutation = useMutation({
    mutationFn: async (data: { role: "student" | "tutor"; profileData?: any }) => {
      await apiRequest("/api/auth/choose-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: data.role }),
      });

      if (data.role === "tutor" && data.profileData) {
        return await apiRequest("/api/tutors/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data.profileData),
        });
      }
      return { ok: true };
    },
    onSuccess: async (_resp, variables) => {
      await refreshUserData();

      if (variables.role === "tutor") {
        toast({
          title: "✅ Application Submitted!",
          description:
            "Your tutor profile has been submitted for review. You'll be notified once approved.",
          duration: 6000,
        });
        setLocation("/pending-approval");
      } else {
        toast({
          title: "Welcome to Daresni!",
          description: "Start browsing tutors and book your first session!",
        });
        // Let the role-aware "/" route decide which dashboard to show
        setLocation("/");
      }
    },
    onError: (error: any) => {
      console.error("Signup error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to complete signup. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedRole) {
      toast({
        title: "Please select a role",
        description: "Choose whether you want to be a student or tutor.",
        variant: "destructive",
      });
      return;
    }

    if (selectedRole === "student") {
      completeSignupMutation.mutate({ role: "student" });
      return;
    }

    const t = formData.tutorData;

    if (!t.phone || !t.bio || !t.experience || !t.education) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    if (t.bio.trim().length < 50) {
      toast({
        title: "Bio too short",
        description: "Please provide a detailed bio (at least 50 characters).",
        variant: "destructive",
      });
      return;
    }

    if (t.subjects.length === 0) {
      toast({
        title: "No subjects selected",
        description: "Please select at least one subject you can teach.",
        variant: "destructive",
      });
      return;
    }

    // Validate pricing based on mode
    if (t.useSamePriceForAll) {
      const hourlyRate = parseFloat(t.hourlyRate);
      if (!t.hourlyRate || isNaN(hourlyRate) || hourlyRate < 5 || hourlyRate > 500) {
        toast({
          title: "Invalid hourly rate",
          description: "Please enter a rate between 5 and 500 BD per hour.",
          variant: "destructive",
        });
        return;
      }
    } else {
      // Check that all selected subjects have pricing
      const missingPricing = t.subjects.filter(
        (subjectId) => !t.subjectPricing[subjectId] || parseFloat(t.subjectPricing[subjectId]) <= 0
      );
      if (missingPricing.length > 0) {
        toast({
          title: "Missing pricing",
          description: "Please set an hourly rate for all selected subjects.",
          variant: "destructive",
        });
        return;
      }
    }

    // Build subject pricing for API
    const subjectPricing: Record<string, number> = {};
    if (t.useSamePriceForAll) {
      const rate = parseFloat(t.hourlyRate);
      t.subjects.forEach((subjectId) => {
        subjectPricing[subjectId] = rate;
      });
    } else {
      t.subjects.forEach((subjectId) => {
        const price = parseFloat(t.subjectPricing[subjectId]);
        if (price > 0) {
          subjectPricing[subjectId] = price;
        }
      });
    }

    const profileData = {
      phone: t.phone,
      bio: t.bio,
      hourlyRate: t.useSamePriceForAll ? parseFloat(t.hourlyRate) : 0,
      subjectPricing,
      experience: t.experience,
      education: t.education,
      subjects: t.subjects,
      certifications: undefined, // Don't send certifications field - can be added later
    };

    completeSignupMutation.mutate({
      role: "tutor",
      profileData,
    });
  };

  const handleSubjectChange = (subjectId: string, checked: boolean) => {
    setFormData((prev) => {
      const set = new Set(prev.tutorData.subjects);
      checked ? set.add(subjectId) : set.delete(subjectId);
      return {
        ...prev,
        tutorData: { ...prev.tutorData, subjects: [...set] },
      };
    });
  };

  const handleSubjectPriceChange = (subjectId: string, price: string) => {
    setFormData((prev) => ({
      ...prev,
      tutorData: {
        ...prev.tutorData,
        subjectPricing: {
          ...prev.tutorData.subjectPricing,
          [subjectId]: price,
        },
      },
    }));
  };

  const togglePricingMode = () => {
    setFormData((prev) => ({
      ...prev,
      tutorData: {
        ...prev.tutorData,
        useSamePriceForAll: !prev.tutorData.useSamePriceForAll,
      },
    }));
  };

  const updateTutorField = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      tutorData: {
        ...prev.tutorData,
        [field]: value,
      },
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white p-4 pt-20">
      <div className="max-w-4xl mx-auto py-8">
        <Card className="shadow-2xl">
          <CardHeader className="text-center bg-gradient-to-r from-[#9B1B30] to-[#7a1625] text-white rounded-t-lg">
            <CardTitle className="text-3xl font-bold">
              Complete Your Daresni Profile
            </CardTitle>
            <CardDescription className="text-white/90 text-lg">
              Tell us about yourself to get started on our platform
            </CardDescription>
          </CardHeader>

          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* STEP 1: Role Selection */}
              <div className="space-y-4">
                <h3 className="text-2xl font-semibold text-gray-900">
                  How would you like to use Daresni?
                </h3>

                <RadioGroup
                  value={selectedRole}
                  onValueChange={(value) =>
                    setSelectedRole(value as "student" | "tutor")
                  }
                  className="space-y-4"
                >
                  {/* Student Option */}
                  <div
                    className={`flex items-center space-x-4 p-6 border-2 rounded-xl transition-all cursor-pointer ${
                      selectedRole === "student"
                        ? "border-blue-500 bg-blue-50 shadow-md"
                        : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/50"
                    }`}
                    onClick={() => setSelectedRole("student")}
                  >
                    <RadioGroupItem value="student" id="role-student" />
                    <Label htmlFor="role-student" className="flex-1 cursor-pointer">
                      <div className="flex items-start space-x-4">
                        <BookOpen className="h-8 w-8 text-blue-600 mt-1 flex-shrink-0" />
                        <div className="flex-1">
                          <h4 className="font-semibold text-xl text-gray-900">
                            I'm a Student
                          </h4>
                          <p className="text-gray-600 mt-1">
                            I want to find qualified tutors to help me learn new
                            subjects or improve my grades.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-3">
                            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Browse verified tutors
                            </Badge>
                            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Schedule sessions
                            </Badge>
                            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Track progress
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </Label>
                  </div>

                  {/* Tutor Option */}
                  <div
                    className={`flex items-center space-x-4 p-6 border-2 rounded-xl transition-all cursor-pointer ${
                      selectedRole === "tutor"
                        ? "border-[#9B1B30] bg-red-50 shadow-md"
                        : "border-gray-200 hover:border-[#9B1B30] hover:bg-red-50/50"
                    }`}
                    onClick={() => setSelectedRole("tutor")}
                  >
                    <RadioGroupItem value="tutor" id="role-tutor" />
                    <Label htmlFor="role-tutor" className="flex-1 cursor-pointer">
                      <div className="flex items-start space-x-4">
                        <GraduationCap className="h-8 w-8 text-[#9B1B30] mt-1 flex-shrink-0" />
                        <div className="flex-1">
                          <h4 className="font-semibold text-xl text-gray-900">
                            I'm a Tutor
                          </h4>
                          <p className="text-gray-600 mt-1">
                            I want to share my knowledge and help students
                            achieve their learning goals.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-3">
                            <Badge variant="secondary" className="bg-red-100 text-[#9B1B30]">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Earn money teaching
                            </Badge>
                            <Badge variant="secondary" className="bg-red-100 text-[#9B1B30]">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Flexible schedule
                            </Badge>
                            <Badge variant="secondary" className="bg-red-100 text-[#9B1B30]">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Build reputation
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* STEP 2: Tutor-specific fields */}
              {selectedRole === "tutor" && (
                <>
                  {/* Notice */}
                  <div className="bg-orange-50 border-l-4 border-orange-500 p-5 rounded-r-lg">
                    <div className="flex items-start space-x-3">
                      <AlertCircle className="h-6 w-6 text-orange-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-semibold text-orange-900 mb-1">
                          Application Review Process
                        </p>
                        <p className="text-orange-800">
                          Your profile will be reviewed by our admin team before you can start
                          tutoring. This typically takes <strong>1–2 business days</strong>. You'll
                          receive an email once approved.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold flex items-center text-gray-900">
                      <Phone className="h-5 w-5 mr-2 text-[#9B1B30]" />
                      Contact Information
                    </h3>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number *</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="+1 (555) 123-4567"
                          value={formData.tutorData.phone}
                          onChange={(e) => updateTutorField("phone", e.target.value)}
                          className="pl-10"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Teaching Information */}
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold flex items-center text-gray-900">
                      <GraduationCap className="h-5 w-5 mr-2 text-[#9B1B30]" />
                      Teaching Information
                    </h3>

                    <div className="space-y-2">
                      <Label htmlFor="bio">Professional Bio * (minimum 50 characters)</Label>
                      <Textarea
                        id="bio"
                        placeholder="Describe your teaching experience, approach, and what makes you a great tutor..."
                        value={formData.tutorData.bio}
                        onChange={(e) => updateTutorField("bio", e.target.value)}
                        className="min-h-32"
                        required
                      />
                      <p
                        className={`text-sm ${
                          formData.tutorData.bio.length < 50
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {formData.tutorData.bio.length}/50 characters
                        {formData.tutorData.bio.length >= 50 && " ✓"}
                      </p>
                    </div>

                    {/* Pricing section - only show toggle if multiple subjects selected */}
                    {formData.tutorData.subjects.length > 1 && (
                      <div className="space-y-3 p-4 bg-gray-50 rounded-lg border">
                        <div className="flex items-center justify-between">
                          <Label className="text-base font-semibold">Pricing Options</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={togglePricingMode}
                            className="text-xs"
                          >
                            {formData.tutorData.useSamePriceForAll
                              ? "Set Different Prices"
                              : "Use Same Price for All"}
                          </Button>
                        </div>
                        <p className="text-xs text-gray-600">
                          {formData.tutorData.useSamePriceForAll
                            ? "All subjects will have the same hourly rate"
                            : "Set a different hourly rate for each subject"}
                        </p>
                      </div>
                    )}

                    {/* Same price for all subjects */}
                    {(formData.tutorData.subjects.length === 0 ||
                      formData.tutorData.subjects.length === 1 ||
                      formData.tutorData.useSamePriceForAll) && (
                      <div className="space-y-2">
                        <Label htmlFor="hourlyRate">Hourly Rate (BD) *</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-3 text-sm font-semibold text-gray-500">
                            BD
                          </span>
                          <Input
                            id="hourlyRate"
                            type="number"
                            placeholder="10"
                            value={formData.tutorData.hourlyRate}
                            onChange={(e) => updateTutorField("hourlyRate", e.target.value)}
                            className="pl-12"
                            min="5"
                            max="500"
                            required={formData.tutorData.useSamePriceForAll}
                          />
                        </div>
                        <p className="text-xs text-gray-500">
                          Recommended: 10–50 BD per hour depending on subject and experience
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Background */}
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold flex items-center text-gray-900">
                      <Award className="h-5 w-5 mr-2 text-[#9B1B30]" />
                      Background & Qualifications
                    </h3>

                    <div className="space-y-2">
                      <Label htmlFor="experience">Teaching Experience *</Label>
                      <Textarea
                        id="experience"
                        placeholder="Describe your teaching experience, years of tutoring, previous roles..."
                        value={formData.tutorData.experience}
                        onChange={(e) => updateTutorField("experience", e.target.value)}
                        className="min-h-24"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="education">Education Background *</Label>
                      <Textarea
                        id="education"
                        placeholder="Your degree, university, relevant coursework..."
                        value={formData.tutorData.education}
                        onChange={(e) => updateTutorField("education", e.target.value)}
                        className="min-h-24"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="certifications">Certifications (Optional)</Label>
                      <Textarea
                        id="certifications"
                        placeholder="Teaching certifications, professional credentials, awards (comma-separated)"
                        value={formData.tutorData.certifications}
                        onChange={(e) => updateTutorField("certifications", e.target.value)}
                        className="min-h-20"
                      />
                    </div>
                  </div>

                  {/* Subjects */}
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold flex items-center text-gray-900">
                      <FileText className="h-5 w-5 mr-2 text-[#9B1B30]" />
                      Subjects You Can Teach *
                    </h3>
                    <p className="text-gray-600">
                      Select all subjects you're qualified to teach (at least one required)
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {subjects.map((subject) => {
                        const sid = `subject-${subject.id}`;
                        const checked = formData.tutorData.subjects.includes(subject.id);
                        return (
                          <div
                            key={subject.id}
                            className={`p-4 border-2 rounded-lg transition-all ${
                              checked
                                ? "border-[#9B1B30] bg-red-50"
                                : "border-gray-200 hover:border-[#9B1B30]/50"
                            }`}
                          >
                            <div className="flex items-center space-x-3">
                              <Checkbox
                                id={sid}
                                checked={checked}
                                onCheckedChange={(isChecked) =>
                                  handleSubjectChange(subject.id, !!isChecked)
                                }
                              />
                              <Label htmlFor={sid} className="flex-1 cursor-pointer">
                                <div className="font-medium">{subject.name}</div>
                                <div className="text-sm text-gray-500">
                                  {(subject as any).description || ""}
                                </div>
                                {(subject as any).category && (
                                  <Badge variant="secondary" className="mt-1 text-xs">
                                    {(subject as any).category}
                                  </Badge>
                                )}
                              </Label>
                            </div>

                            {/* Show individual pricing input when different pricing mode is active */}
                            {checked && !formData.tutorData.useSamePriceForAll && (
                              <div className="mt-3 flex items-center gap-2 pl-8">
                                <Label htmlFor={`price-${subject.id}`} className="text-xs whitespace-nowrap">
                                  Price:
                                </Label>
                                <div className="relative flex-1">
                                  <span className="absolute left-2 top-2 text-xs font-semibold text-gray-500">
                                    BD
                                  </span>
                                  <Input
                                    id={`price-${subject.id}`}
                                    type="number"
                                    placeholder="10"
                                    value={formData.tutorData.subjectPricing[subject.id] || ""}
                                    onChange={(e) => handleSubjectPriceChange(subject.id, e.target.value)}
                                    className="pl-10 h-8 text-sm"
                                    min="5"
                                    max="500"
                                  />
                                </div>
                                <span className="text-xs text-gray-500 whitespace-nowrap">BD/hr</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {formData.tutorData.subjects.length > 0 && (
                      <p className="text-sm text-green-600 flex items-center">
                        <CheckCircle className="h-4 w-4 mr-1" />
                        {formData.tutorData.subjects.length} subject(s) selected
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Submit Button */}
              <div className="pt-6 border-t">
                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-[#9B1B30] hover:bg-[#7a1625] text-lg py-6"
                  disabled={!selectedRole || completeSignupMutation.isPending}
                >
                  {completeSignupMutation.isPending ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      <span>Processing...</span>
                    </div>
                  ) : selectedRole === "tutor" ? (
                    "Submit Tutor Application"
                  ) : selectedRole === "student" ? (
                    "Start Learning"
                  ) : (
                    "Continue"
                  )}
                </Button>

                {selectedRole === "tutor" && (
                  <p className="text-center text-sm text-gray-500 mt-4">
                    By submitting, you agree to have your profile reviewed by our admin team.
                  </p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
