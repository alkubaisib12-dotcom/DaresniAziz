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
import { Loader2, Upload, User, Clock, AlertCircle, DollarSign, GraduationCap, Briefcase, Phone, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { db } from "@/lib/firebase";
import { collection, getDocs, orderBy, query as fbQuery } from "firebase/firestore";
import { Switch } from "@/components/ui/switch";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  profileImageUrl: z.string().optional().or(z.literal("")),
});

const tutorProfileSchema = z.object({
  phone: z.string().optional(),
  bio: z.string().optional(),
  hourlyRate: z.number().min(0, "Rate must be positive"),
  experience: z.string().optional(),
  education: z.string().optional(),
  subjects: z.array(z.string()).min(1, "Select at least one subject"),
  subjectPricing: z.record(z.number()),
  useSamePriceForAll: z.boolean(),
  certificationFiles: z.array(z.object({
    url: z.string(),
    name: z.string(),
  })).optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type TutorProfileFormData = z.infer<typeof tutorProfileSchema>;

interface Subject {
  id: string;
  name: string;
  category?: string;
  description?: string;
}

export default function ProfileSettings() {
  const { user, refreshUserData } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(user?.profileImageUrl || null);

  // Fetch tutor profile if user is a tutor
  const { data: tutorProfile, isLoading: tutorProfileLoading } = useQuery({
    queryKey: ["/api/tutors/profile"],
    queryFn: async () => {
      const res = await apiRequest("/api/tutors/profile");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load tutor profile");
      return res.json();
    },
    enabled: user?.role === "tutor",
  });

  // Fetch subjects for tutors
  const { data: subjects = [] } = useQuery<Subject[]>({
    queryKey: ["firestore", "subjects"],
    staleTime: 60_000,
    queryFn: async () => {
      const q = fbQuery(collection(db, "subjects"), orderBy("name", "asc"));
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name ?? "",
          category: data.category ?? "",
          description: data.description ?? "",
        } as Subject;
      });
    },
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

  const tutorForm = useForm<TutorProfileFormData>({
    resolver: zodResolver(tutorProfileSchema),
    defaultValues: {
      phone: "",
      bio: "",
      hourlyRate: 0,
      experience: "",
      education: "",
      subjects: [],
      subjectPricing: {},
      useSamePriceForAll: true,
      certificationFiles: [],
    },
  });

  // Update tutor form when profile loads
  useEffect(() => {
    if (tutorProfile) {
      tutorForm.reset({
        phone: tutorProfile.phone || "",
        bio: tutorProfile.bio || "",
        hourlyRate: tutorProfile.hourlyRate || tutorProfile.pricePerHour || 0,
        experience: tutorProfile.experience || "",
        education: tutorProfile.education || "",
        subjects: tutorProfile.subjects?.map((s: any) => s.id || s) || [],
        subjectPricing: tutorProfile.subjectPricing || {},
        useSamePriceForAll: !tutorProfile.subjectPricing || Object.keys(tutorProfile.subjectPricing).length === 0,
        certificationFiles: tutorProfile.certifications || [],
      });
    }
  }, [tutorProfile, tutorForm]);

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
    mutationFn: async (data: TutorProfileFormData) => {
      // Build subject pricing based on mode
      const subjectPricing: Record<string, number> = {};
      if (data.useSamePriceForAll) {
        data.subjects.forEach((subjectId) => {
          subjectPricing[subjectId] = data.hourlyRate;
        });
      } else {
        for (const subjectId of data.subjects) {
          const price = data.subjectPricing[subjectId] || 0;
          if (price > 0) {
            subjectPricing[subjectId] = price;
          }
        }
      }

      const payload = {
        phone: data.phone?.trim(),
        bio: data.bio?.trim(),
        hourlyRate: data.hourlyRate,
        subjectPricing,
        experience: data.experience?.trim(),
        education: data.education?.trim(),
        certifications: data.certificationFiles || [],
        subjects: data.subjects,
      };

      return await apiRequest("/api/tutors/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: async () => {
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

  const handleCertUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload a file smaller than 10MB",
        variant: "destructive",
      });
      return;
    }

    setUploadingCert(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      const fileUrl = data.url;

      const currentFiles = tutorForm.getValues("certificationFiles") || [];
      tutorForm.setValue("certificationFiles", [
        ...currentFiles,
        { url: fileUrl, name: file.name },
      ]);

      toast({
        title: "File uploaded",
        description: "Certification file uploaded. Click Save to apply changes.",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: "Failed to upload file. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingCert(false);
    }
  };

  const removeCertification = (index: number) => {
    const currentFiles = tutorForm.getValues("certificationFiles") || [];
    tutorForm.setValue("certificationFiles", currentFiles.filter((_, i) => i !== index));
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

  const onTutorSubmit = (data: TutorProfileFormData) => {
    updateTutorProfileMutation.mutate(data);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  const selectedSubjects = tutorForm.watch("subjects") || [];
  const useSamePriceForAll = tutorForm.watch("useSamePriceForAll");

  return (
    <div className="container mx-auto px-4 py-8 mt-16">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" data-testid="title-profile-settings">
            Profile Settings
          </h1>
          <p className="text-muted-foreground">
            Manage your personal information and {user.role === "tutor" && "tutor"} profile
          </p>
        </div>

        {/* Personal Information Card */}
        <Card className="mb-6">
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
                  <p className="text-xs text-muted-foreground">
                    Your role cannot be changed
                  </p>
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

        {/* Tutor Profile Card - Only show for tutors */}
        {user.role === "tutor" && (
          <Card>
            <CardHeader>
              <CardTitle>Tutor Profile</CardTitle>
              <CardDescription>
                Manage your tutoring information, rates, and subjects
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tutorProfileLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <Form {...tutorForm}>
                  <form onSubmit={tutorForm.handleSubmit(onTutorSubmit)} className="space-y-6">
                    {/* Phone */}
                    <FormField
                      control={tutorForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <div className="flex items-center gap-2">
                              <Phone className="h-4 w-4" />
                              Phone Number
                            </div>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Enter your phone number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Bio */}
                    <FormField
                      control={tutorForm.control}
                      name="bio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bio / About Me</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Tell students about yourself and your teaching style..."
                              className="min-h-[120px]"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Experience */}
                    <FormField
                      control={tutorForm.control}
                      name="experience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <div className="flex items-center gap-2">
                              <Briefcase className="h-4 w-4" />
                              Experience
                            </div>
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Describe your teaching and professional experience..."
                              className="min-h-[100px]"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Education */}
                    <FormField
                      control={tutorForm.control}
                      name="education"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            <div className="flex items-center gap-2">
                              <GraduationCap className="h-4 w-4" />
                              Education
                            </div>
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="List your degrees, certifications, and relevant education..."
                              className="min-h-[100px]"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Subjects */}
                    <FormField
                      control={tutorForm.control}
                      name="subjects"
                      render={() => (
                        <FormItem>
                          <FormLabel>Subjects You Teach</FormLabel>
                          <FormDescription>
                            Select all subjects you're qualified to teach
                          </FormDescription>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                            {subjects.map((subject) => (
                              <FormField
                                key={subject.id}
                                control={tutorForm.control}
                                name="subjects"
                                render={({ field }) => {
                                  return (
                                    <FormItem
                                      key={subject.id}
                                      className="flex flex-row items-start space-x-3 space-y-0"
                                    >
                                      <FormControl>
                                        <Checkbox
                                          checked={field.value?.includes(subject.id)}
                                          onCheckedChange={(checked) => {
                                            return checked
                                              ? field.onChange([...field.value, subject.id])
                                              : field.onChange(
                                                  field.value?.filter(
                                                    (value) => value !== subject.id
                                                  )
                                                );
                                          }}
                                        />
                                      </FormControl>
                                      <FormLabel className="font-normal cursor-pointer">
                                        {subject.name}
                                      </FormLabel>
                                    </FormItem>
                                  );
                                }}
                              />
                            ))}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Pricing Mode Toggle */}
                    <FormField
                      control={tutorForm.control}
                      name="useSamePriceForAll"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">
                              Same Price For All Subjects
                            </FormLabel>
                            <FormDescription>
                              Use one hourly rate for all subjects
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* Base Hourly Rate (shown when same price for all) */}
                    {useSamePriceForAll && (
                      <FormField
                        control={tutorForm.control}
                        name="hourlyRate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              <div className="flex items-center gap-2">
                                <DollarSign className="h-4 w-4" />
                                Hourly Rate (SAR)
                              </div>
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                placeholder="e.g., 100"
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                              />
                            </FormControl>
                            <FormDescription>
                              Your rate applies to all selected subjects
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    {/* Per-Subject Pricing (shown when different prices) */}
                    {!useSamePriceForAll && selectedSubjects.length > 0 && (
                      <div className="space-y-4">
                        <div>
                          <Label className="text-base">Pricing Per Subject (SAR/hour)</Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            Set individual rates for each subject
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {selectedSubjects.map((subjectId) => {
                            const subject = subjects.find((s) => s.id === subjectId);
                            if (!subject) return null;

                            return (
                              <FormField
                                key={subjectId}
                                control={tutorForm.control}
                                name={`subjectPricing.${subjectId}` as any}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>{subject.name}</FormLabel>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="1"
                                        placeholder="Rate"
                                        {...field}
                                        value={field.value || ""}
                                        onChange={(e) => {
                                          const currentPricing = tutorForm.getValues("subjectPricing");
                                          tutorForm.setValue("subjectPricing", {
                                            ...currentPricing,
                                            [subjectId]: Number(e.target.value),
                                          });
                                        }}
                                      />
                                    </FormControl>
                                  </FormItem>
                                )}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Certifications */}
                    <div className="space-y-4">
                      <div>
                        <Label className="text-base">Certifications & Documents</Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Upload your teaching certifications, degrees, or credentials
                        </p>
                      </div>

                      {/* Current Certifications */}
                      {tutorForm.watch("certificationFiles")?.length > 0 && (
                        <div className="space-y-2">
                          {tutorForm.watch("certificationFiles")?.map((file, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between p-3 border rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm">{file.name}</span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeCertification(index)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Upload Button */}
                      <div>
                        <Label htmlFor="cert-upload" className="cursor-pointer">
                          <div className="flex items-center gap-2 px-4 py-2 border-2 border-dashed rounded-lg hover:bg-muted transition-colors w-full justify-center">
                            {uploadingCert ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Uploading...</span>
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4" />
                                <span>Upload Certification</span>
                              </>
                            )}
                          </div>
                        </Label>
                        <Input
                          id="cert-upload"
                          type="file"
                          className="hidden"
                          onChange={handleCertUpload}
                          disabled={uploadingCert}
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          PDF, JPG, PNG, or DOC. Max size 10MB
                        </p>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="submit"
                        disabled={updateTutorProfileMutation.isPending || uploadingCert}
                      >
                        {updateTutorProfileMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save Tutor Profile"
                        )}
                      </Button>
                    </div>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
