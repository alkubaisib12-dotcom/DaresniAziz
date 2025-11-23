import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AuthModal } from "@/components/AuthModal";
import { BookOpen, Users, Clock, Star, ChevronRight } from "lucide-react";
import type { Subject, TutorProfile, User, Review } from "@shared/schema";
import { formatMoney } from "@/lib/currency";
import { useAuth } from "@/hooks/useAuth";

const subjectIcons: Record<string, string> = {
  Mathematics: "fas fa-calculator",
  Science: "fas fa-flask",
  Languages: "fas fa-language",
  Programming: "fas fa-code",
  Physics: "fas fa-atom",
  Chemistry: "fas fa-flask",
  Biology: "fas fa-dna",
  English: "fas fa-book",
  History: "fas fa-landmark",
  Art: "fas fa-palette",
  Music: "fas fa-music",
  Business: "fas fa-briefcase",
};

type TutorWithDetails = TutorProfile & {
  user: User | null;
  subjects: Subject[];
};

export default function Landing() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"student" | "tutor" | "admin">(
    "student",
  );
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Fetch real subjects from database
  const { data: subjects = [], isLoading: subjectsLoading } = useQuery<Subject[]>(
    {
      queryKey: ["/api/subjects"],
    },
  );

  // Fetch real tutors from database
  const { data: allTutors = [], isLoading: tutorsLoading } =
    useQuery<TutorWithDetails[]>({
      queryKey: ["/api/tutors"],
    });

  // Fetch platform statistics
  const { data: stats } = useQuery<{
    tutors: number;
    students: number;
    sessions: number;
  }>({
    queryKey: ["/api/stats"],
  });

  // Get top 6 tutors by rating for featured section
  const featuredTutors = allTutors
    .filter((tutor) => tutor.isActive && tutor.isVerified)
    .sort(
      (a, b) =>
        parseFloat((b as any).totalRating || "0") -
        parseFloat((a as any).totalRating || "0"),
    )
    .slice(0, 6);

  const handleBookSession = () => {
    setShowAuthModal(true);
  };

  const handleLogin = () => {
    setShowAuthModal(true);
  };

  return (
    <div className="bg-background">
      {/* Header */}
      <header className="gradient-header shadow-lg relative z-50">
        <nav className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="text-white text-2xl font-bold">
                <i className="fas fa-graduation-cap mr-2" />
                Daresni
              </div>
            </div>

            <div className="hidden md:flex items-center space-x-8">
              <a
                href="#subjects"
                className="text-white hover:text-gray-200 transition-colors"
              >
                Find Tutors
              </a>
              <a
                href="#how-it-works"
                className="text-white hover:text-gray-200 transition-colors"
              >
                How it Works
              </a>
            </div>

            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                className="text-white hover:text-gray-200 hover:bg-white/10"
                onClick={handleLogin}
                data-testid="button-signin"
              >
                Sign In
              </Button>
              <Button
                className="bg-white text-primary hover:bg-gray-100"
                onClick={handleLogin}
                data-testid="button-get-started"
              >
                Get Started
              </Button>
            </div>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="hero-gradient py-20">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <h1 className="text-5xl lg:text-6xl font-bold text-foreground leading-tight">
                Learn from the
                <span className="text-primary"> Best Tutors</span>
                <br />
                Worldwide
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Connect with verified expert tutors for personalized 1-on-1
                learning sessions. Book instantly, learn effectively, and
                achieve your academic goals.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  className="btn-primary text-lg px-8 py-6"
                  onClick={handleLogin}
                  data-testid="button-find-tutor"
                >
                  <i className="fas fa-search mr-2" />
                  Find Your Tutor
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="border-2 border-primary text-primary hover:bg-primary hover:text-white text-lg px-8 py-6"
                  onClick={handleLogin}
                  data-testid="button-become-tutor"
                >
                  <i className="fas fa-chalkboard-teacher mr-2" />
                  Become a Tutor
                </Button>
              </div>

              <div className="flex items-center space-x-8 pt-8">
                <div className="text-center">
                  <div
                    className="text-3xl font-bold text-primary"
                    data-testid="text-total-tutors"
                  >
                    {stats?.tutors || 0}
                  </div>
                  <div className="text-muted-foreground">Expert Tutors</div>
                </div>
                <div className="text-center">
                  <div
                    className="text-3xl font-bold text-primary"
                    data-testid="text-total-students"
                  >
                    {stats?.students || 0}
                  </div>
                  <div className="text-muted-foreground">Happy Students</div>
                </div>
                <div className="text-center">
                  <div
                    className="text-3xl font-bold text-primary"
                    data-testid="text-total-sessions"
                  >
                    {stats?.sessions || 0}
                  </div>
                  <div className="text-muted-foreground">Sessions Completed</div>
                </div>
              </div>
            </div>

            <div className="relative">
              <img
                src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600"
                alt="Students collaborating in a modern classroom setting"
                className="rounded-2xl shadow-2xl w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Subject Categories */}
      <section id="subjects" className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-foreground mb-4">
              Popular Subjects
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Choose from hundreds of subjects taught by expert tutors
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {subjectsLoading ? (
              // Loading skeleton
              [...Array(8)].map((_, i) => (
                <Card key={i} className="text-center">
                  <CardContent className="p-6">
                    <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-4 animate-pulse" />
                    <div className="h-4 bg-muted rounded mb-2 animate-pulse" />
                    <div className="h-3 bg-muted rounded mb-3 animate-pulse" />
                    <div className="h-3 bg-muted rounded w-24 mx-auto animate-pulse" />
                  </CardContent>
                </Card>
              ))
            ) : subjects.length > 0 ? (
              subjects.slice(0, 8).map((subject) => {
                const icon = subjectIcons[subject.name] || "fas fa-book";
                const tutorCount = allTutors.filter((t) =>
                  t.subjects?.some((s) => s.id === subject.id),
                ).length;

                return (
                  <Card
                    key={subject.id}
                    className="card-hover text-center group cursor-pointer"
                    data-testid={`card-subject-${subject.id}`}
                    onClick={handleLogin}
                  >
                    <CardContent className="p-6">
                      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/20 transition-colors">
                        <i className={`${icon} text-2xl text-primary`} />
                      </div>
                      <h3 className="font-semibold text-lg text-foreground mb-2">
                        {subject.name}
                      </h3>
                      <p className="text-muted-foreground text-sm mb-3">
                        {subject.description || "Expert tutoring available"}
                      </p>
                      <div className="text-primary font-medium">
                        {tutorCount} {tutorCount === 1 ? "tutor" : "tutors"}{" "}
                        available
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <div className="col-span-full text-center text-muted-foreground py-8">
                No subjects available yet
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Featured Tutors */}
      <section className="py-20 bg-secondary">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-foreground mb-4">
              Featured Tutors
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Meet our top-rated, verified tutors ready to help you succeed
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {tutorsLoading ? (
              // Loading skeleton
              [...Array(6)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <div className="flex items-start space-x-4 mb-4">
                      <div className="w-16 h-16 bg-muted rounded-full animate-pulse" />
                      <div className="flex-1">
                        <div className="h-4 bg-muted rounded mb-2 animate-pulse" />
                        <div className="h-3 bg-muted rounded w-24 animate-pulse" />
                      </div>
                    </div>
                    <div className="h-12 bg-muted rounded mb-4 animate-pulse" />
                    <div className="h-10 bg-muted rounded animate-pulse" />
                  </CardContent>
                </Card>
              ))
            ) : featuredTutors.length > 0 ? (
              featuredTutors.map((tutor) => {
                const tutorName =
                  `${tutor.user?.firstName || ""} ${
                    tutor.user?.lastName || ""
                  }`.trim() || "Tutor";
                const rating = parseFloat(
                  (tutor as any).totalRating || "0",
                ).toFixed(1);
                const reviewCount = (tutor as any).totalReviews || 0;
                const primarySubject =
                  tutor.subjects?.[0]?.name || "Various Subjects";
                const profileImage =
                  tutor.user?.profileImageUrl || "/uploads/default-avatar.png";

                return (
                  <Card
                    key={tutor.id}
                    className="card-hover"
                    data-testid={`card-tutor-${tutor.id}`}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start space-x-4 mb-4">
                        <img
                          src={profileImage}
                          alt={`${tutorName} profile`}
                          className="w-16 h-16 rounded-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = "/images/daresni-logo.svg";
                          }}
                        />
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg text-foreground">
                            {tutorName}
                          </h3>
                          <p className="text-muted-foreground text-sm">
                            {primarySubject}
                          </p>
                          {parseFloat(rating) > 0 && (
                            <div className="flex items-center mt-2">
                              <div className="flex text-yellow-400">
                                {[...Array(5)].map((_, i) => (
                                  <i
                                    key={i}
                                    className={`${
                                      i < Math.round(parseFloat(rating))
                                        ? "fas"
                                        : "far"
                                    } fa-star text-xs`}
                                  />
                                ))}
                              </div>
                              <span className="text-sm text-muted-foreground ml-2">
                                {rating} ({reviewCount}{" "}
                                {reviewCount === 1 ? "review" : "reviews"})
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-primary">
                            {formatMoney(tutor.hourlyRate ?? 0)}/hr
                          </div>
                          <div className="w-3 h-3 rounded-full ml-auto mt-1 bg-success" />
                        </div>
                      </div>

                      <p className="text-muted-foreground text-sm mb-4 line-clamp-3">
                        {tutor.bio ||
                          "Experienced tutor ready to help you achieve your learning goals."}
                      </p>

                      {tutor.subjects && tutor.subjects.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {tutor.subjects.slice(0, 3).map((subject) => (
                            <Badge
                              key={subject.id}
                              variant="secondary"
                              className="bg-primary/10 text-primary"
                            >
                              {subject.name}
                            </Badge>
                          ))}
                          {tutor.subjects.length > 3 && (
                            <Badge
                              variant="secondary"
                              className="bg-primary/10 text-primary"
                            >
                              +{tutor.subjects.length - 3} more
                            </Badge>
                          )}
                        </div>
                      )}

                      <div className="flex space-x-2">
                        {user?.role !== "tutor" && (
                          <Button
                            className="btn-primary flex-1"
                            onClick={handleLogin}
                            data-testid={`button-book-session-${tutor.id}`}
                          >
                            <i className="fas fa-calendar-plus mr-2" />
                            Book Session
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={handleLogin}
                          data-testid={`button-view-profile-${tutor.id}`}
                        >
                          <i className="fas fa-user" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <div className="col-span-full text-center text-muted-foreground py-8">
                No tutors available yet. Be the first to join as a tutor!
              </div>
            )}
          </div>

          <div className="text-center mt-12">
            <Button
              className="btn-primary px-8 py-3"
              onClick={handleLogin}
              data-testid="button-view-all-tutors"
            >
              View All Tutors
            </Button>
          </div>
        </div>
      </section>

      {/* Dashboard Previews */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-foreground mb-4">
              Powerful Dashboards for Everyone
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Tailored experiences for students, tutors, and administrators
            </p>
          </div>

          <div className="flex justify-center mb-8">
            <div className="bg-muted rounded-lg p-1 flex">
              {(["student", "tutor", "admin"] as const).map((tab) => (
                <Button
                  key={tab}
                  variant={activeTab === tab ? "default" : "ghost"}
                  className={`px-6 py-3 rounded-md font-medium transition-all ${
                    activeTab === tab
                      ? "tab-active"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`button-tab-${tab}`}
                >
                  <i
                    className={`${
                      tab === "student"
                        ? "fas fa-user-graduate"
                        : tab === "tutor"
                        ? "fas fa-chalkboard-teacher"
                        : "fas fa-cog"
                    } mr-2`}
                  />
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          {activeTab === "student" && (
            <Card className="overflow-hidden shadow-lg">
              <div className="bg-gradient-to-r from-primary to-primary-dark p-6 text-white">
                <h3 className="text-2xl font-bold mb-2">Student Dashboard</h3>
                <p className="opacity-90">Manage your learning journey</p>
              </div>

              <CardContent className="p-6">
                <div className="grid lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-accent/30 rounded-xl p-4">
                      <h4 className="font-semibold text-lg mb-4 flex items-center">
                        <i className="fas fa-calendar-alt mr-2 text-primary" />
                        Upcoming Sessions
                      </h4>
                      <div className="space-y-3">
                        <Card className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                                <i className="fas fa-calculator text-primary" />
                              </div>
                              <div>
                                <div className="font-medium">
                                  Calculus with Dr. Chen
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Today at 3:00 PM
                                </div>
                              </div>
                            </div>
                            <Button
                              className="btn-primary"
                              data-testid="button-join-session"
                            >
                              Join
                            </Button>
                          </div>
                        </Card>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <Card className="p-4">
                      <h5 className="font-semibold mb-3">Learning Progress</h5>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Mathematics</span>
                            <span>78%</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full"
                              style={{ width: "78%" }}
                            />
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 bg-secondary">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-foreground mb-4">
              How Daresni Works
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Get started with personalized tutoring in just three simple steps
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "Find Your Perfect Tutor",
                description:
                  "Browse through hundreds of verified tutors, filter by subject, price, and rating to find your ideal match.",
              },
              {
                step: "2",
                title: "Book & Pay Securely",
                description:
                  "Schedule sessions at your convenience and pay securely through our platform with full money-back guarantee.",
              },
              {
                step: "3",
                title: "Learn & Achieve Goals",
                description:
                  "Attend interactive online sessions, track your progress, and achieve your academic goals with expert guidance.",
              },
            ].map((item, index) => (
              <div key={index} className="text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <span className="text-2xl font-bold text-primary">
                    {item.step}
                  </span>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  {item.title}
                </h3>
                <p className="text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 gradient-header">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">
            Ready to Start Your Learning Journey?
          </h2>
          <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
            Join thousands of students already learning with expert tutors on
            Daresni
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              className="bg-white text-primary hover:bg-gray-100 px-8 py-4 text-lg"
              onClick={handleLogin}
              data-testid="button-signup-student"
            >
              <i className="fas fa-user-graduate mr-2" />
              Sign Up as Student
            </Button>
            <Button
              variant="outline"
              className="border-2 border-white text-white hover:bg-white/10 px-8 py-4 text-lg"
              onClick={handleLogin}
              data-testid="button-signup-tutor"
            >
              <i className="fas fa-chalkboard-teacher mr-2" />
              Become a Tutor
            </Button>
          </div>

          <div className="mt-8 text-white/80">
            <p>✓ Free to join ✓ Verified tutors ✓ Money-back guarantee</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-white py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="text-2xl font-bold mb-4 flex items-center">
                <i className="fas fa-graduation-cap mr-2" />
                Daresni
              </div>
              <p className="text-gray-300 mb-4">
                Connecting students with expert tutors worldwide for
                personalized learning experiences.
              </p>
              <div className="flex space-x-4">
                <a
                  href="#"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  <i className="fab fa-facebook text-xl" />
                </a>
                <a
                  href="#"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  <i className="fab fa-twitter text-xl" />
                </a>
                <a
                  href="#"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  <i className="fab fa-linkedin text-xl" />
                </a>
                <a
                  href="#"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  <i className="fab fa-instagram text-xl" />
                </a>
              </div>
            </div>

            {[
              {
                title: "For Students",
                links: [
                  "Find Tutors",
                  "Book Sessions",
                  "How it Works",
                  "Success Stories",
                ],
              },
              {
                title: "For Tutors",
                links: [
                  "Become a Tutor",
                  "Tutor Resources",
                  "Payment Info",
                  "Support",
                ],
              },
              {
                title: "Company",
                links: ["About Us", "Contact", "Privacy Policy", "Terms of Service"],
              },
            ].map((section, index) => (
              <div key={index}>
                <h3 className="font-semibold text-lg mb-4">{section.title}</h3>
                <ul className="space-y-2">
                  {section.links.map((link, linkIndex) => (
                    <li key={linkIndex}>
                      <a
                        href="#"
                        className="text-gray-300 hover:text-white transition-colors"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-600 mt-8 pt-8 text-center text-gray-300">
            <p>&copy; 2024 Daresni. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
