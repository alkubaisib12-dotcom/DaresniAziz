import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  TutorProfile as TutorProfileFS,
  User as UserFS,
  Subject as SubjectFS,
} from "@shared/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TutorCard } from "@/components/TutorCard";
import { BookingModal } from "@/components/BookingModal";
import {
  TutorMatchWizard,
  type TutorFilters,
} from "@/components/TutorMatchWizard";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

/* ------------------------------------------------------------------ */
/* Local favorites (per user) stored in localStorage                   */
/* ------------------------------------------------------------------ */
function useLocalFavorites(userId?: string) {
  const key = userId ? `favorites:${userId}` : undefined;
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      setFavorites(raw ? JSON.parse(raw) : []);
    } catch {
      setFavorites([]);
    }
  }, [key]);

  const save = (next: string[]) => {
    setFavorites(next);
    if (key) localStorage.setItem(key, JSON.stringify(next));
  };

  const toggle = (id: string) =>
    save(favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id]);

  const isFav = (id: string) => favorites.includes(id);

  return { favorites, toggle, isFav };
}

/* ------------------------------------------------------------------ */
/* View Model for cards                                               */
/* ------------------------------------------------------------------ */
type TutorVM = TutorProfileFS & {
  user: UserFS;
  // NOTE: API may send strings OR full subject objects – we'll handle that at runtime.
  subjects: any[];
  totalRating?: number | string;
  totalReviews?: number;
  isActive?: boolean;
  isVerified?: boolean;
  // AI ranking data
  aiScore?: number;
  aiBreakdown?: {
    subjectExpertise: number;
    ratingScore: number;
    successMetrics: number;
    availability: number;
    valueScore: number;
    experience: number;
  };
  aiReasoning?: string[];
};

export default function TutorBrowse() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSubject, setSelectedSubject] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("rating");
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedTutor, setSelectedTutor] = useState<TutorVM | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardFilters, setWizardFilters] = useState<TutorFilters | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();
  const { favorites, toggle, isFav } = useLocalFavorites(user?.id);

  /* --------------------------- Load tutors from API --------------------------- */
  // Use AI recommendations when wizard filters are active
  const shouldUseAI = !!wizardFilters?.subjectId;
  const apiEndpoint = shouldUseAI ? "/api/tutors/recommended" : "/api/tutors";

  const queryParams = shouldUseAI && wizardFilters
    ? new URLSearchParams({
        subjectId: wizardFilters.subjectId!,
        ...(wizardFilters.maxRate && { maxBudget: wizardFilters.maxRate.toString() }),
        limit: "20",
      }).toString()
    : "";

  const {
    data: tutors = [],
    isLoading: tutorsLoading,
  } = useQuery<TutorVM[]>({
    queryKey: [apiEndpoint, queryParams],
    queryFn: async () => {
      const url = queryParams ? `${apiEndpoint}?${queryParams}` : apiEndpoint;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch tutors");
      return res.json();
    },
  });

  /* --------------------- Derive subjects from tutors -------------------------- */
  const subjectsForFilter: SubjectFS[] = useMemo(() => {
    const map = new Map<string, SubjectFS>();

    tutors.forEach((tutor) => {
      const subjectArr = (tutor.subjects ?? []) as any[];

      subjectArr.forEach((raw) => {
        // Skip plain string subjects – we only want full objects for the filter list
        const s: SubjectFS | null =
          typeof raw === "string" ? null : (raw as SubjectFS);

        if (!s?.id) return;
        if (!map.has(s.id)) map.set(s.id, s);
      });
    });

    return Array.from(map.values());
  }, [tutors]);

  /* ------------------------------- Filters ------------------------------------ */
  const filteredTutors = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    const base = tutors.filter((tutor) => {
      const subjectArr = (tutor.subjects ?? []) as any[];

      const matchesSearch =
        !term ||
        (tutor.user?.firstName ?? "").toLowerCase().includes(term) ||
        (tutor.user?.lastName ?? "").toLowerCase().includes(term) ||
        subjectArr.some((raw) => {
          if (typeof raw === "string") {
            return raw.toLowerCase().includes(term);
          }
          const s = raw as SubjectFS;
          return (s.name ?? "").toLowerCase().includes(term);
        });

      const matchesSubject =
        selectedSubject === "all" ||
        subjectArr.some((raw) => {
          if (typeof raw === "string") {
            // if the API ever sends IDs as strings
            return raw === selectedSubject;
          }
          const s = raw as SubjectFS;
          return s.id === selectedSubject;
        });

      let matchesWizard = true;
      if (wizardFilters) {
        if (wizardFilters.subjectId) {
          matchesWizard =
            matchesWizard &&
            subjectArr.some((raw) => {
              if (typeof raw === "string") {
                return raw === wizardFilters.subjectId;
              }
              const s = raw as SubjectFS;
              return s.id === wizardFilters.subjectId;
            });
        }
        if (wizardFilters.maxRate) {
          matchesWizard =
            matchesWizard &&
            (tutor.hourlyRate || 0) * 100 <= wizardFilters.maxRate;
        }
        if (wizardFilters.minRating) {
          const r = parseFloat(String(tutor.totalRating ?? 0));
          matchesWizard = matchesWizard && r >= wizardFilters.minRating;
        }
      }

      return matchesSearch && matchesSubject && matchesWizard;
    });

    const sorted = [...base].sort((a, b) => {
      // If AI scores are present, prioritize them
      if (a.aiScore !== undefined && b.aiScore !== undefined) {
        return b.aiScore - a.aiScore;
      }

      // Fallback to manual sorting
      switch (sortBy) {
        case "rating":
          return (
            parseFloat(String(b.totalRating ?? 0)) -
            parseFloat(String(a.totalRating ?? 0))
          );
        case "price-low":
          return (a.hourlyRate ?? 0) - (b.hourlyRate ?? 0);
        case "price-high":
          return (b.hourlyRate ?? 0) - (a.hourlyRate ?? 0);
        case "reviews":
          return (b.totalReviews ?? 0) - (a.totalReviews ?? 0);
        default:
          return 0;
      }
    });

    return sorted;
  }, [tutors, searchTerm, selectedSubject, sortBy, wizardFilters]);

  /* --------------------------- Handlers --------------------------------------- */
  const handleBookSession = (tutor: TutorVM) => {
    if (user?.role === "tutor") {
      toast({
        title: "Cannot book session",
        description: "Only students can book sessions. Tutors cannot book sessions.",
        variant: "destructive",
      });
      return;
    }
    setSelectedTutor(tutor);
    setShowBookingModal(true);
  };

  const handleBookingConfirm = () => {
    setShowBookingModal(false);
    toast({
      title: "Session booked!",
      description: "You’ll find it in My Sessions.",
    });
  };

  const handleFavoriteToggle = (tutorId: string) => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to save favorites",
        variant: "destructive",
      });
      return;
    }
    toggle(tutorId);
  };

  const handleWizardComplete = (filters: TutorFilters) => {
    setWizardFilters(filters);
    setShowWizard(false);
    toast({
      title: "AI Matching Activated!",
      description: "Showing personalized tutor recommendations based on your preferences.",
    });
  };

  const clearWizardFilters = () => {
    setWizardFilters(null);
    toast({
      title: "AI Matching Deactivated",
      description: "Showing all tutors.",
    });
  };

  /* ------------------------------ UI ----------------------------------------- */
  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1
                className="text-3xl font-bold text-foreground"
                data-testid="text-browse-title"
              >
                Find Your Perfect Tutor
              </h1>
              <p className="text-muted-foreground mt-2">
                Browse through our verified tutors and book your ideal learning
                session
              </p>
            </div>
            <Button
              size="lg"
              className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
              onClick={() => setShowWizard(true)}
              data-testid="button-find-best-tutor"
            >
              <i className="fas fa-magic mr-2" />
              Find Best Tutor
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <Input
                  placeholder="Search tutors or subjects..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search"
                />
              </div>
              <div>
                <Select
                  value={selectedSubject}
                  onValueChange={setSelectedSubject}
                >
                  <SelectTrigger data-testid="select-subject">
                    <SelectValue placeholder="All Subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    {subjectsForFilter.map((subject) => (
                      <SelectItem key={subject.id} value={subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger data-testid="select-sort">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rating">Highest Rated</SelectItem>
                    <SelectItem value="price-low">
                      Price: Low to High
                    </SelectItem>
                    <SelectItem value="price-high">
                      Price: High to Low
                    </SelectItem>
                    <SelectItem value="reviews">Most Reviews</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedSubject("all");
                    setSortBy("rating");
                  }}
                  data-testid="button-clear-filters"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Smart Filters Active Indicator */}
        {wizardFilters && (
          <Card className="mb-6 border-primary bg-gradient-to-r from-primary/10 to-pink-500/10">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full p-2">
                    <i className="fas fa-brain" />
                  </div>
                  <div>
                    <div className="font-semibold flex items-center">
                      <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                        AI-Powered Recommendations Active
                      </span>
                      <Badge className="ml-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs">
                        Smart Match
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {wizardFilters.subjectName && (
                        <Badge variant="secondary">
                          <i className="fas fa-book mr-1" />
                          {wizardFilters.subjectName}
                        </Badge>
                      )}
                      {wizardFilters.maxRate &&
                        wizardFilters.maxRate < 999999 && (
                          <Badge variant="secondary">
                            <i className="fas fa-dollar-sign mr-1" />
                            Under ${wizardFilters.maxRate / 100}/hr
                          </Badge>
                        )}
                      {wizardFilters.minRating &&
                        wizardFilters.minRating > 0 && (
                          <Badge variant="secondary">
                            <i className="fas fa-star mr-1" />
                            {wizardFilters.minRating}+ rating
                          </Badge>
                        )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearWizardFilters}
                  data-testid="button-clear-wizard-filters"
                >
                  <i className="fas fa-times mr-2" />
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              {filteredTutors.length} tutors found
            </h2>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-primary/10 text-primary">
                <i className="fas fa-check-circle mr-1" />
                All verified
              </Badge>
            </div>
          </div>
        </div>

        {/* Tutors Grid */}
        {tutorsLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center space-x-4">
                      <div className="w-16 h-16 bg-muted rounded-full" />
                      <div className="space-y-2 flex-1">
                        <div className="h-4 bg-muted rounded w-3/4" />
                        <div className="h-3 bg-muted rounded w-1/2" />
                      </div>
                    </div>
                    <div className="h-3 bg-muted rounded" />
                    <div className="h-3 bg-muted rounded w-2/3" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredTutors.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTutors.map((tutor) => (
              <TutorCard
                key={tutor.id}
                tutor={tutor}
                onBook={() => handleBookSession(tutor)}
                onViewProfile={() => (window.location.href = `/tutors/${tutor.id}`)}
                onFavorite={() => handleFavoriteToggle(tutor.id)}
                isFavorite={isFav(tutor.id)}
              />
            ))}
          </div>
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <div className="space-y-4">
                <i className="fas fa-search text-4xl text-muted-foreground" />
                <h3 className="text-xl font-semibold">No tutors found</h3>
                <p className="text-muted-foreground">
                  Try adjusting your search criteria or browse all tutors
                </p>
                <Button
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedSubject("all");
                  }}
                  data-testid="button-browse-all"
                >
                  Browse All Tutors
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Load More (placeholder) */}
        {filteredTutors.length > 12 && (
          <div className="text-center mt-8">
            <Button variant="outline" data-testid="button-load-more">
              Load More Tutors
            </Button>
          </div>
        )}
      </div>

      {/* Booking Modal */}
      {showBookingModal && selectedTutor && (
        <BookingModal
          tutor={selectedTutor}
          onClose={() => setShowBookingModal(false)}
          onConfirm={handleBookingConfirm}
        />
      )}

      {/* Tutor Match Wizard */}
      <TutorMatchWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
      />
    </div>
  );
}
