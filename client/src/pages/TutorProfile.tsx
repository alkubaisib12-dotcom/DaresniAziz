import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import { useAuth } from "@/components/AuthProvider";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/lib/currency";
import { ChatWindow } from "@/components/ChatWindow";
import { MessageSquare } from "lucide-react";

/** ======= Minimal local types ======= */
type UserLite = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
};

type SubjectLite = { id: string; name: string };

type TutorProfileLite = {
  id: string; // tutor_profiles.id
  userId: string; // users.id
  bio?: string | null;
  education?: string | null;
  experience?: string | null;
  hourlyRate?: number | null;
  subjectPricing?: Record<string, number>; // subject-specific pricing
  isVerified?: boolean;
  isActive?: boolean;
  user: UserLite | null;
  subjects: SubjectLite[];
};

type ReviewLite = {
  id: string;
  rating: number;
  comment?: string | null;
  createdAt: string | Date;
  studentId: string;
  student: UserLite | null;
};

type Slot = { start: string; end: string; available: boolean; at: string };

/** ======= Helpers ======= */
function fmtYMD(d: Date) {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeDateLabel(value: string | Date) {
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

function getTutorPricingDisplay(tutor: TutorProfileLite | null): string {
  if (!tutor) return "Not set";

  const { subjectPricing, hourlyRate } = tutor;

  // If subjectPricing exists and has values, use it
  if (subjectPricing && Object.keys(subjectPricing).length > 0) {
    const prices = Object.values(subjectPricing).filter(p => p > 0);
    if (prices.length === 0) return "Not set";

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    if (minPrice === maxPrice) {
      return formatMoney(minPrice);
    } else {
      return `${formatMoney(minPrice)} - ${formatMoney(maxPrice)}`;
    }
  }

  // Fallback to hourlyRate (deprecated field)
  if (hourlyRate && hourlyRate > 0) {
    return formatMoney(hourlyRate);
  }

  return "Not set";
}

export default function TutorProfile() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);

  // For review form
  const [ratingInput, setRatingInput] = useState<number>(5);
  const [commentInput, setCommentInput] = useState<string>("");

  // For chat window
  const [showChat, setShowChat] = useState<boolean>(false);

  /** ------- Load this tutor by id (uses apiRequest -> JSON) ------- */
  const {
    data: tutor,
    isLoading: tutorLoading,
  } = useQuery<TutorProfileLite | null>({
    queryKey: ["/api/tutors", id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      try {
        const data = await apiRequest(`/api/tutors/${id}`);
        if (!data) return null;
        return data as TutorProfileLite;
      } catch (err) {
        console.error("Failed to load tutor profile", err);
        return null;
      }
    },
  });

  /** Global subjects (fallback if tutor.subjects empty) */
  const { data: allSubjects = [] } = useQuery<Array<SubjectLite>>({
    queryKey: ["/api/subjects"],
  });

  /** Reviews for this tutor */
  const { data: reviews = [] } = useQuery<Array<ReviewLite>>({
    queryKey: ["/api/reviews", id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return [];
      try {
        const data = await apiRequest(`/api/reviews/${id}`);
        return (Array.isArray(data) ? data : []) as ReviewLite[];
      } catch (err) {
        console.error("Failed to load reviews", err);
        return [];
      }
    },
  });

  /** Rating summary */
  const ratingAvg =
    reviews && reviews.length
      ? reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviews.length
      : 0;
  const totalReviews = reviews?.length ?? 0;

  const myReview =
    user && reviews.length > 0
      ? reviews.find((r) => r.studentId === user.id)
      : undefined;
  const canWriteReview = user?.role === "student" && !myReview;

  /** Daily availability (with bookings removed) */
  const dateKey = selectedDate ? fmtYMD(selectedDate) : "";

  const {
    data: availability,
    isFetching: availLoading,
  } = useQuery<{ slots: Slot[] } | null>({
    queryKey: ["availability", id, dateKey],
    enabled: !!id && !!dateKey,
    queryFn: async () => {
      if (!id) return { slots: [] };
      const data = await apiRequest(`/api/tutors/${id}/availability?date=${dateKey}`);
      return (data as { slots: Slot[] }) ?? { slots: [] };
    },
  });

  /** Booking mutation */
  const createSession = useMutation({
    mutationFn: async (payload: {
      tutorId: string;
      subjectId: string;
      scheduledAt: string; // ISO
      duration: number;
      priceCents: number;
      notes?: string;
    }) => {
      return await apiRequest("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      toast({
        title: "Booked!",
        description: "Your session request has been sent to the tutor.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["availability", id, dateKey] }),
      ]);
      setSelectedSlot(null);
    },
    onError: (e: any) => {
      toast({
        title: "Couldn’t book",
        description: e?.message || "Failed to book session",
        variant: "destructive",
      });
    },
  });

  /** Review creation mutation */
  const createReview = useMutation({
    mutationFn: async (payload: { tutorId: string; rating: number; comment: string }) => {
      return await apiRequest("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      toast({
        title: "Review submitted",
        description: "Thank you for your feedback.",
      });
      setCommentInput("");
      setRatingInput(5);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/reviews", id] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tutors"] }),
      ]);
    },
    onError: (e: any) => {
      toast({
        title: "Couldn’t submit review",
        description:
          e?.message ||
          "You can only review tutors you’ve had a completed session with.",
        variant: "destructive",
      });
    },
  });

  const handleBookSelected = () => {
    if (!user) {
      window.location.href = "/";
      return;
    }
    if (!tutor) return;
    if (!selectedDate || !selectedSlot) {
      toast({
        title: "Pick a time",
        description: "Select an available time slot.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedSlot.available) {
      toast({
        title: "Unavailable",
        description: "Please choose an available slot.",
        variant: "destructive",
      });
      return;
    }

    const subjectsForTutor = tutor.subjects?.length ? tutor.subjects : allSubjects || [];
    const firstSubjectId = subjectsForTutor[0]?.id;
    if (!firstSubjectId) {
      toast({
        title: "Missing subject",
        description: "No subjects are configured for this tutor.",
        variant: "destructive",
      });
      return;
    }

    const duration = 60; // minutes
    const priceCents = Math.round(Number(tutor.hourlyRate || 0) * 100 * (duration / 60));

    createSession.mutate({
      tutorId: tutor.id,
      subjectId: firstSubjectId,
      scheduledAt: selectedSlot.at,
      duration,
      priceCents,
    });
  };

  const handleSubmitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !tutor || !canWriteReview) return;
    const trimmed = commentInput.trim();
    if (!ratingInput || ratingInput < 1 || ratingInput > 5) {
      toast({
        title: "Invalid rating",
        description: "Please choose a rating between 1 and 5.",
        variant: "destructive",
      });
      return;
    }
    createReview.mutate({
      tutorId: tutor.id,
      rating: ratingInput,
      comment: trimmed,
    });
  };

  /** ---------- Loading & not-found states ---------- */
  if (tutorLoading) {
    return (
      <div className="min-h-screen bg-background pt-16">
        <div className="container mx-auto px-4 py-8">
          <Card className="py-12">
            <CardContent>
              <p className="text-center text-muted-foreground">Loading tutor profile…</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!tutor) {
    return (
      <div className="min-h-screen bg-background pt-16">
        <div className="container mx-auto px-4 py-8">
          <Card className="text-center py-12">
            <CardContent>
              <div className="space-y-4">
                <i className="fas fa-user-slash text-4xl text-muted-foreground"></i>
                <h3 className="text-xl font-semibold">Tutor not found</h3>
                <p className="text-muted-foreground">
                  The tutor you&apos;re looking for doesn&apos;t exist or may have been
                  removed.
                </p>
                <Button onClick={() => (window.location.href = "/tutors")}>
                  Browse Tutors
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // At this point tutor is loaded.
  const firstName = tutor.user?.firstName ?? "Tutor";
  const lastName = tutor.user?.lastName ?? "";
  const profileImageUrl = tutor.user?.profileImageUrl ?? "";

  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main */}
          <div className="lg:col-span-2 space-y-8">
            <Card>
              <CardContent className="p-8">
                <div className="flex items-start space-x-6">
                  <Avatar className="w-24 h-24">
                    <AvatarImage src={profileImageUrl || undefined} alt={firstName} />
                    <AvatarFallback className="text-2xl">
                      {firstName?.[0]}
                      {lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h1
                          className="text-3xl font-bold text-foreground"
                          data-testid="text-tutor-name"
                        >
                          {firstName} {lastName}
                        </h1>
                        <p className="text-muted-foreground text-lg">
                          {tutor.subjects?.length
                            ? tutor.subjects.map((s) => s.name).join(" • ")
                            : "General Tutoring"}
                        </p>
                      </div>
                      <div className="text-right">
                        <div
                          className="text-3xl font-bold text-primary"
                          data-testid="text-hourly-rate"
                        >
                          {getTutorPricingDisplay(tutor)}/hr
                        </div>
                        {tutor.isVerified && (
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            <i className="fas fa-check-circle mr-1" />
                            Verified
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-6 mb-6">
                      <div className="flex items-center space-x-2">
                        <div className="flex text-yellow-400">
                          {[...Array(5)].map((_, i) => (
                            <i
                              key={i}
                              className={`fas fa-star ${
                                i < Math.floor(ratingAvg) ? "" : "text-gray-300"
                              }`}
                            />
                          ))}
                        </div>
                        <span className="font-medium" data-testid="text-rating">
                          {ratingAvg.toFixed(1)}
                        </span>
                        <span className="text-muted-foreground">
                          ({totalReviews} reviews)
                        </span>
                      </div>
                    </div>

                    {user?.role !== "tutor" && (
                      <div className="flex space-x-4">
                        <Button
                          size="lg"
                          className="btn-primary px-8"
                          onClick={handleBookSelected}
                          data-testid="button-book-session"
                        >
                          <i className="fas fa-calendar-plus mr-2" />
                          Book Selected Time
                        </Button>
                        {user?.role === "student" && tutor.userId && (
                          <Button
                            size="lg"
                            variant="outline"
                            className="px-8"
                            onClick={() => setShowChat(true)}
                            data-testid="button-start-chat"
                          >
                            <MessageSquare className="h-5 w-5 mr-2" />
                            Message Tutor
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs defaultValue="about" className="space-y-6">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="about">About</TabsTrigger>
                <TabsTrigger value="experience">Experience</TabsTrigger>
                <TabsTrigger value="reviews">Reviews ({totalReviews})</TabsTrigger>
                <TabsTrigger value="availability">Availability</TabsTrigger>
              </TabsList>

              <TabsContent value="about">
                <Card>
                  <CardHeader>
                    <CardTitle>About {firstName}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div>
                        <h4 className="font-semibold mb-2">Bio</h4>
                        <p className="text-muted-foreground leading-relaxed">
                          {tutor.bio || "—"}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-3">Subjects</h4>
                        <div className="flex flex-wrap gap-2">
                          {(tutor.subjects?.length ? tutor.subjects : allSubjects || [])
                            .slice(0, 6)
                            .map((subject) => (
                              <Badge
                                key={subject.id}
                                variant="outline"
                                className="bg-primary/10 text-primary"
                              >
                                {subject.name}
                              </Badge>
                            ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="experience">
                <Card>
                  <CardHeader>
                    <CardTitle>Experience & Qualifications</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div>
                        <h4 className="font-semibold mb-2">Teaching Experience</h4>
                        <p className="text-muted-foreground leading-relaxed">
                          {tutor.experience || "—"}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-semibold mb-2">Education</h4>
                        <p className="text-muted-foreground leading-relaxed">
                          {tutor.education || "—"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="reviews">
                <Card>
                  <CardHeader>
                    <CardTitle>Student Reviews</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Existing reviews */}
                    {reviews.length > 0 && (
                      <div className="space-y-4 mb-6">
                        {reviews.map((review) => (
                          <div
                            key={review.id}
                            className="border rounded-lg p-3 flex items-start gap-3"
                          >
                            <Avatar className="w-8 h-8">
                              <AvatarImage
                                src={review.student?.profileImageUrl || undefined}
                              />
                              <AvatarFallback>
                                {review.student?.firstName?.[0] ||
                                  review.student?.lastName?.[0] ||
                                  "S"}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-sm">
                                    {review.student?.firstName}{" "}
                                    {review.student?.lastName}
                                  </div>
                                  <div className="flex items-center text-yellow-400 text-xs mt-1">
                                    {[...Array(5)].map((_, i) => (
                                      <i
                                        key={i}
                                        className={`fas fa-star ${
                                          i < review.rating ? "" : "text-gray-300"
                                        }`}
                                      />
                                    ))}
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {safeDateLabel(review.createdAt)}
                                </div>
                              </div>
                              {review.comment && (
                                <p className="text-sm text-muted-foreground mt-2">
                                  {review.comment}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* No reviews message (for non-students) */}
                    {reviews.length === 0 && user?.role !== "student" && (
                      <p className="text-sm text-muted-foreground">
                        No reviews yet. Book a session to be the first to review.
                      </p>
                    )}

                    {/* Review form for students */}
                    {user?.role === "student" && (
                      <div className="border-t pt-4 mt-4">
                        <h4 className="font-semibold mb-2">
                          {myReview ? "Your review" : "Write a review"}
                        </h4>

                        {myReview ? (
                          <p className="text-sm text-muted-foreground">
                            You&apos;ve already reviewed this tutor.
                          </p>
                        ) : (
                          <form
                            onSubmit={handleSubmitReview}
                            className="space-y-3"
                            data-testid="form-add-review"
                          >
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">
                                Rating
                              </p>
                              <div className="flex space-x-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRatingInput(star)}
                                    className="focus:outline-none"
                                  >
                                    <i
                                      className={
                                        star <= ratingInput
                                          ? "fas fa-star text-yellow-400"
                                          : "far fa-star text-gray-300"
                                      }
                                    />
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <p className="text-xs text-muted-foreground mb-1">
                                Comment (optional)
                              </p>
                              <textarea
                                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                                rows={3}
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                placeholder="How was your experience with this tutor?"
                              />
                            </div>

                            <div className="flex justify-end">
                              <Button
                                type="submit"
                                size="sm"
                                disabled={createReview.isPending}
                                data-testid="button-submit-review"
                              >
                                {createReview.isPending ? "Submitting…" : "Submit review"}
                              </Button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              You can only review tutors you&apos;ve had a completed
                              session with.
                            </p>
                          </form>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="availability">
                <Card>
                  <CardHeader>
                    <CardTitle>Schedule a Session</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-semibold mb-4">Select Date</h4>
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={(d) => {
                            setSelectedDate(d);
                            setSelectedSlot(null);
                          }}
                          className="rounded-md border"
                          disabled={(d) => !!d && d < new Date(new Date().toDateString())}
                        />
                      </div>
                      <div>
                        <h4 className="font-semibold mb-4">Available Times</h4>

                        {availLoading ? (
                          <div className="text-sm text-muted-foreground">
                            Loading availability…
                          </div>
                        ) : !availability || availability.slots.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            No availability for the selected day.
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {availability.slots.map((slot) => {
                              const label = slot.start; // HH:mm
                              const disabled = !slot.available;
                              const active = selectedSlot?.at === slot.at;
                              return (
                                <Button
                                  key={slot.at}
                                  variant={active ? "default" : "outline"}
                                  className={`justify-center ${
                                    disabled ? "opacity-50 cursor-not-allowed" : ""
                                  }`}
                                  disabled={disabled}
                                  onClick={() => setSelectedSlot(slot)}
                                  data-testid={`button-time-${label.replace(
                                    /[^a-zA-Z0-9]/g,
                                    "-"
                                  )}`}
                                >
                                  {label}
                                </Button>
                              );
                            })}
                          </div>
                        )}

                        {user?.role !== "tutor" && (
                          <Button
                            className="w-full mt-6 btn-primary"
                            onClick={handleBookSelected}
                            disabled={!selectedSlot || createSession.isPending}
                            data-testid="button-book-selected-time"
                          >
                            {createSession.isPending ? "Booking…" : "Book Selected Time"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Contact {firstName}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {user?.role !== "tutor" && (
                    <Button
                      className="w-full btn-primary"
                      onClick={handleBookSelected}
                      data-testid="button-book-now"
                    >
                      <i className="fas fa-calendar-plus mr-2" />
                      Book Now
                    </Button>
                  )}
                  {/* You can also add "Open Chat" here if needed */}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Similar Tutors</CardTitle>
              </CardHeader>
              <CardContent>{/* optional recommendations later */}</CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Chat Window */}
      {showChat && tutor?.userId && (
        <ChatWindow userId={tutor.userId} onClose={() => setShowChat(false)} />
      )}
    </div>
  );
}
