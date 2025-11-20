import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Loader2, Upload, User, Clock, AlertCircle } from "lucide-react";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  profileImageUrl: z.string().optional().or(z.literal("")),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function ProfileSettings() {
  const { user, refreshUserData } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(user?.profileImageUrl || null);

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
      </div>
    </div>
  );
}
