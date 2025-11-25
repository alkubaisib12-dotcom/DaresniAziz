import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Loader2, Upload, Clock, AlertCircle, Phone, GraduationCap, FileText, Award } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { Subject } from "@shared/schema";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  profileImageUrl: z.string().optional().or(z.literal("")),
});

const tutorContactSchema = z.object({
  phone: z.string().min(1, "Phone number is required"),
});

const tutorTeachingSchema = z.object({
  bio: z.string().min(10, "Bio must be at least 10 characters"),
  hourlyRate: z.number().min(0, "Hourly rate must be 0 or greater"),
});

const tutorBackgroundSchema = z.object({
  experience: z.string().min(1, "Experience is required"),
  education: z.string().min(1, "Education is required"),
  certifications: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type TutorContactFormData = z.infer<typeof tutorContactSchema>;
type TutorTeachingFormData = z.infer<typeof tutorTeachingSchema>;
type TutorBackgroundFormData = z.infer<typeof tutorBackgroundSchema>;

export default function ProfileSettings() {
  const { user, refreshUserData } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(user?.profileImageUrl || null);

  // Tutor-specific state
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [useSamePriceForAll, setUseSamePriceForAll] = useState(true);
  const [subjectPricing, setSubjectPricing] = useState<Record<string, string>>({});

  // Fetch tutor profile if user is a tutor (includes subjects in the response)
  const { data: tutorProfileData, isLoading: tutorProfileLoading } = useQuery({
    queryKey: ["/api/tutors/profile"],
    enabled: user?.role === "tutor",
  });

  // Extract profile and subjects from the response
  const tutorProfile = tutorProfileData ? { ...tutorProfileData, subjects: undefined } : null;
  const tutorSubjects = tutorProfileData?.subjects || [];

  // Fetch all subjects for subject selection
  const { data: allSubjects = [] } = useQuery<Subject[]>({
    queryKey: ["/api/subjects"],
    enabled: user?.role === "tutor",
  });

  // Check if user can change name (7-day limit)
  const canChangeName = useMemo(() => {
    if (!user?.lastNameChangeAt) return true;

    const lastChange = new Date(user.lastNameChangeAt);
    const now = new Date();
    const daysSinceLastChange = (now.getTime() - lastChange.getTime()) / (1000 * 60 * 60 * 24);

    return daysSinceLastChange >= 7;
  }, [user?.lastNameChangeAt]);

  const daysUntilCanChange = useMemo(() => {
    if (!user?.lastNameChangeAt || canChangeName) return 0;

    const lastChange = new Date(user.lastNameChangeAt);
    const now = new Date();
    const daysSinceLastChange = (now.getTime() - lastChange.getTime()) / (1000 * 60 * 60 * 24);

    return Math.ceil(7 - daysSinceLastChange);
  }, [user?.lastNameChangeAt, canChangeName]);

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      profileImageUrl: user?.profileImageUrl || "",
    },
  });

  const contactForm = useForm<TutorContactFormData>({
    resolver: zodResolver(tutorContactSchema),
    defaultValues: {
      phone: "",
    },
  });

  const teachingForm = useForm<TutorTeachingFormData>({
    resolver: zodResolver(tutorTeachingSchema),
    defaultValues: {
      bio: "",
      hourlyRate: 0,
    },
  });

  const backgroundForm = useForm<TutorBackgroundFormData>({
    resolver: zodResolver(tutorBackgroundSchema),
    defaultValues: {
      experience: "",
      education: "",
      certifications: "",
    },
  });

  // Reset form when user data changes (after successful update)
  useEffect(() => {
    if (user) {
      form.reset({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        profileImageUrl: user.profileImageUrl || "",
      });
      setImagePreview(user.profileImageUrl || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Reset tutor forms when tutor profile data changes
  useEffect(() => {
    if (tutorProfile) {
      contactForm.reset({
        phone: tutorProfile.phone || "",
      });

      teachingForm.reset({
        bio: tutorProfile.bio || "",
        hourlyRate: tutorProfile.hourlyRate || 0,
      });

      backgroundForm.reset({
        experience: tutorProfile.experience || "",
        education: tutorProfile.education || "",
        certifications: "", // Not stored as string in backend
      });

      // Set pricing state
      if (tutorProfile.subjectPricing && Object.keys(tutorProfile.subjectPricing).length > 0) {
        const pricing: Record<string, string> = {};
        Object.entries(tutorProfile.subjectPricing).forEach(([subjectId, price]) => {
          pricing[subjectId] = String(price);
        });
        setSubjectPricing(pricing);

        // Check if all prices are the same
        const prices = Object.values(tutorProfile.subjectPricing);
        const allSame = prices.length > 0 && prices.every((p) => p === prices[0]);
        setUseSamePriceForAll(allSame);
      } else {
        setUseSamePriceForAll(tutorProfile.hourlyRate > 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorProfile]);

  // Initialize selected subjects when tutor subjects load
  useEffect(() => {
    if (Array.isArray(tutorSubjects) && tutorSubjects.length > 0) {
      setSelectedSubjects(tutorSubjects.map((s: any) => s.id));
    }
  }, [tutorSubjects]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      return await apiRequest("/api/user/profile", {
        method: "PUT",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      await refreshUserData();
      toast({
        title: "Success!",
        description: "Your profile has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const updateTutorProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("/api/tutors/profile", {
        method: "PUT",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tutors/profile"] });
      toast({
        title: "Success!",
        description: "Your tutor profile has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update tutor profile",
        variant: "destructive",
      });
    },
  });

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      // Create form data
      const formData = new FormData();
      formData.append("file", file);

      // Upload to object storage
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      const imageUrl = data.url;

      // Update preview and form
      setImagePreview(imageUrl);
      form.setValue("profileImageUrl", imageUrl);

      toast({
        title: "Image uploaded",
        description: "Your profile picture has been uploaded. Click Save to apply changes.",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmit = (data: ProfileFormData) => {
    // Check if name is being changed
    const nameChanged = data.firstName !== user?.firstName || data.lastName !== user?.lastName;

    if (nameChanged && !canChangeName) {
      toast({
        title: "Cannot change name",
        description: `You can only change your name once every 7 days. Please wait ${daysUntilCanChange} more day(s).`,
        variant: "destructive",
      });
      return;
    }

    updateProfileMutation.mutate(data);
  };

  const onContactSubmit = (data: TutorContactFormData) => {
    updateTutorProfileMutation.mutate(data);
  };

  const onTeachingSubmit = (data: TutorTeachingFormData) => {
    // Build the update data
    const updateData: any = {
      bio: data.bio,
    };

    // Handle pricing based on mode
    if (useSamePriceForAll) {
      updateData.hourlyRate = data.hourlyRate;
      // Build subject pricing for all subjects
      if (selectedSubjects.length > 0) {
        const pricing: Record<string, number> = {};
        selectedSubjects.forEach((subjectId) => {
          pricing[subjectId] = data.hourlyRate;
        });
        updateData.subjectPricing = pricing;
      }
    } else {
      updateData.hourlyRate = 0;
      // Use per-subject pricing
      const pricing: Record<string, number> = {};
      selectedSubjects.forEach((subjectId) => {
        const price = parseFloat(subjectPricing[subjectId] || "0");
        if (price > 0) {
          pricing[subjectId] = price;
        }
      });
      updateData.subjectPricing = pricing;
    }

    updateTutorProfileMutation.mutate(updateData);
  };

  const onBackgroundSubmit = (data: TutorBackgroundFormData) => {
    updateTutorProfileMutation.mutate({
      experience: data.experience,
      education: data.education,
    });
  };

  const handleSubjectChange = (subjectId: string, checked: boolean) => {
    setSelectedSubjects((prev) => {
      const set = new Set(prev);
      checked ? set.add(subjectId) : set.delete(subjectId);
      return Array.from(set);
    });
  };

  const handleSubjectPriceChange = (subjectId: string, price: string) => {
    setSubjectPricing((prev) => ({
      ...prev,
      [subjectId]: price,
    }));
  };

  const handleSaveSubjects = () => {
    if (selectedSubjects.length === 0) {
      toast({
        title: "No subjects selected",
        description: "Please select at least one subject.",
        variant: "destructive",
      });
      return;
    }

    // Validate pricing
    if (useSamePriceForAll) {
      const hourlyRate = teachingForm.getValues("hourlyRate");
      if (!hourlyRate || hourlyRate < 1) {
        toast({
          title: "Invalid pricing",
          description: "Please set a valid hourly rate in the Teaching Information section.",
          variant: "destructive",
        });
        return;
      }
    } else {
      const missingPricing = selectedSubjects.filter(
        (subjectId) => !subjectPricing[subjectId] || parseFloat(subjectPricing[subjectId]) <= 0
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

    // Build subject pricing
    const pricing: Record<string, number> = {};
    if (useSamePriceForAll) {
      const rate = teachingForm.getValues("hourlyRate");
      selectedSubjects.forEach((subjectId) => {
        pricing[subjectId] = rate;
      });
    } else {
      selectedSubjects.forEach((subjectId) => {
        const price = parseFloat(subjectPricing[subjectId]);
        if (price > 0) {
          pricing[subjectId] = price;
        }
      });
    }

    updateTutorProfileMutation.mutate({
      subjects: selectedSubjects,
      subjectPricing: pricing,
      hourlyRate: useSamePriceForAll ? teachingForm.getValues("hourlyRate") : 0,
    });
  };

  const togglePricingMode = () => {
    setUseSamePriceForAll(!useSamePriceForAll);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 mt-16">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" data-testid="title-profile-settings">
            Profile Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your personal information and profile picture
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              Update your name and profile picture
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Profile Picture Section */}
                <div className="flex flex-col items-center gap-4">
                  <Avatar className="h-32 w-32">
                    <AvatarImage src={imagePreview || undefined} alt={user.firstName || "User"} />
                    <AvatarFallback className="text-2xl">
                      {user.firstName?.[0]}{user.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex flex-col items-center gap-2">
                    <Label
                      htmlFor="image-upload"
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                        {isUploading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Uploading...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4" />
                            <span>Upload Picture</span>
                          </>
                        )}
                      </div>
                    </Label>
                    <Input
                      id="image-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                      disabled={isUploading}
                      data-testid="input-profile-picture"
                    />
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG or GIF. Max size 5MB
                    </p>
                  </div>
                </div>

                {/* Name Change Restriction Warning */}
                {!canChangeName && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span>
                        You can change your name again in {daysUntilCanChange} day(s).
                        Names can only be changed once every 7 days.
                      </span>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Name Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter your first name"
                            {...field}
                            disabled={!canChangeName}
                            data-testid="input-first-name"
                          />
                        </FormControl>
                        {!canChangeName && (
                          <FormDescription className="text-xs text-muted-foreground">
                            Name changes are limited to once per 7 days
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter your last name"
                            {...field}
                            disabled={!canChangeName}
                            data-testid="input-last-name"
                          />
                        </FormControl>
                        {!canChangeName && (
                          <FormDescription className="text-xs text-muted-foreground">
                            Name changes are limited to once per 7 days
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Email (Read-only) */}
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={user.email}
                    disabled
                    className="bg-muted"
                    data-testid="input-email-readonly"
                  />
                  <p className="text-xs text-muted-foreground">
                    Your email cannot be changed
                  </p>
                </div>

                {/* Role (Read-only) */}
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input
                    value={user.role?.charAt(0).toUpperCase() + user.role?.slice(1) || ""}
                    disabled
                    className="bg-muted"
                    data-testid="input-role-readonly"
                  />
                </div>

                {/* Submit Button */}
                <div className="flex justify-end gap-2">
                  <Button
                    type="submit"
                    disabled={updateProfileMutation.isPending || isUploading}
                    data-testid="button-save-profile"
                  >
                    {updateProfileMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Tutor Profile Sections - Only for tutors */}
        {user.role === "tutor" && (
          <>
            {tutorProfileLoading ? (
              <div className="flex items-center justify-center py-8 mt-6">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <>
                {/* Contact Information */}
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Phone className="h-5 w-5 text-[#9B1B30]" />
                      Contact Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...contactForm}>
                      <form onSubmit={contactForm.handleSubmit(onContactSubmit)} className="space-y-4">
                        <FormField
                          control={contactForm.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone Number *</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                                  <Input
                                    placeholder="+1 (555) 123-4567"
                                    {...field}
                                    className="pl-10"
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex justify-end">
                          <Button type="submit" disabled={updateTutorProfileMutation.isPending}>
                            {updateTutorProfileMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              "Save Contact"
                            )}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>

                {/* Teaching Information */}
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <GraduationCap className="h-5 w-5 text-[#9B1B30]" />
                      Teaching Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...teachingForm}>
                      <form onSubmit={teachingForm.handleSubmit(onTeachingSubmit)} className="space-y-4">
                        {/* Bio */}
                        <FormField
                          control={teachingForm.control}
                          name="bio"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Professional Bio * (minimum 50 characters)</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Describe your teaching experience, approach, and what makes you a great tutor..."
                                  className="min-h-[100px]"
                                  {...field}
                                />
                              </FormControl>
                              <p
                                className={`text-sm ${
                                  field.value.length < 50
                                    ? "text-red-600"
                                    : "text-green-600"
                                }`}
                              >
                                {field.value.length}/50 characters
                              </p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Pricing Options */}
                        {selectedSubjects.length > 1 && (
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
                                {useSamePriceForAll
                                  ? "Set Different Prices"
                                  : "Use Same Price for All"}
                              </Button>
                            </div>
                            <p className="text-xs text-gray-600">
                              {useSamePriceForAll
                                ? "All subjects will have the same hourly rate"
                                : "Set a different hourly rate for each subject"}
                            </p>
                          </div>
                        )}

                        {/* Hourly Rate - Show when using same price for all or single/no subjects */}
                        {(selectedSubjects.length === 0 ||
                          selectedSubjects.length === 1 ||
                          useSamePriceForAll) && (
                          <FormField
                            control={teachingForm.control}
                            name="hourlyRate"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Hourly Rate (BD) *</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <span className="absolute left-3 top-3 text-sm font-semibold text-gray-500">
                                      BD
                                    </span>
                                    <Input
                                      type="number"
                                      min="1"
                                      step="0.01"
                                      placeholder="15"
                                      {...field}
                                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                      className="pl-12"
                                    />
                                  </div>
                                </FormControl>
                                <FormDescription>
                                  Recommended: 10–50 BD per hour depending on subject and experience
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        <div className="flex justify-end">
                          <Button type="submit" disabled={updateTutorProfileMutation.isPending}>
                            {updateTutorProfileMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              "Save Teaching Info"
                            )}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>

                {/* Subjects You Can Teach */}
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-[#9B1B30]" />
                      Subjects You Can Teach *
                    </CardTitle>
                    <CardDescription>
                      Select all subjects you're qualified to teach (at least one required)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {allSubjects.map((subject) => {
                        const sid = `subject-${subject.id}`;
                        const checked = selectedSubjects.includes(subject.id);
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
                            {checked && !useSamePriceForAll && (
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
                                    value={subjectPricing[subject.id] || ""}
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

                    {selectedSubjects.length > 0 && (
                      <p className="text-sm text-green-600 flex items-center">
                        <svg className="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        {selectedSubjects.length} subject(s) selected
                      </p>
                    )}

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={handleSaveSubjects}
                        disabled={updateTutorProfileMutation.isPending || selectedSubjects.length === 0}
                      >
                        {updateTutorProfileMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save Subjects"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Background & Qualifications */}
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Award className="h-5 w-5 text-[#9B1B30]" />
                      Background & Qualifications
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...backgroundForm}>
                      <form onSubmit={backgroundForm.handleSubmit(onBackgroundSubmit)} className="space-y-4">
                        {/* Experience */}
                        <FormField
                          control={backgroundForm.control}
                          name="experience"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Teaching Experience *</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Describe your teaching experience, years of tutoring, previous roles..."
                                  className="min-h-24"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription>
                                How long have you been tutoring?
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Education */}
                        <FormField
                          control={backgroundForm.control}
                          name="education"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Education Background *</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Your degree, university, relevant coursework..."
                                  className="min-h-24"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription>
                                Your educational background and qualifications
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Certifications */}
                        <FormField
                          control={backgroundForm.control}
                          name="certifications"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Certifications (Optional)</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Teaching certifications, professional credentials, awards (comma-separated)"
                                  className="min-h-20"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end">
                          <Button type="submit" disabled={updateTutorProfileMutation.isPending}>
                            {updateTutorProfileMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              "Save Background"
                            )}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
