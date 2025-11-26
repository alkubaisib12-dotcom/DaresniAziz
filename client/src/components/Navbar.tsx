import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import {
  User,
  Settings,
  Bell,
  LogOut,
  Home,
  Calendar,
  FileText,
  Search,
  IdCard,
  Sparkles,
  Gamepad2,
  BookOpen,
  GraduationCap,
} from "lucide-react";

type Role = "student" | "tutor" | "admin" | null;

type MeResponse = {
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
    role?: Role;
  };
  hasTutorProfile: boolean;
  tutorProfile?: {
    id: string;
    isVerified?: boolean;
    isActive?: boolean;
  };
};

export default function Navbar() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Current user + attached tutor profile (id/verification)
  const { data: me } = useQuery<MeResponse>({
    queryKey: ["/api/me"],
    enabled: !!user, // avoid 401 spam before login
  });

  // Unread notifications (poll)
  const { data: unread = 0 } = useQuery({
    queryKey: ["unread-notifications-count"],
    enabled: !!user, // only poll when signed in
    queryFn: async (): Promise<number> => {
      const res = await fetch("/api/notifications/unread-count", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) return 0;
      const json = await res.json();
      return Number(json?.unread ?? 0);
    },
    refetchInterval: 30_000, // Optimized: 30s instead of 15s
    staleTime: 20_000, // Optimized: 20s instead of 10s
  });

  const handleLogout = async () => {
    try {
      await signOut();
      toast({
        title: "Goodbye!",
        description: "You have been successfully signed out.",
      });
    } catch {
      toast({
        title: "Sign out failed",
        description: "There was an error signing you out. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Always send "Dashboard" to "/" (AuthRouteGate decides which dashboard)
  const desktopNav = useMemo(
    () => [
      { href: "/", label: "Dashboard", icon: "fas fa-home" },
      { href: "/tutors", label: "Find Tutors", icon: "fas fa-search" },
    ],
    [],
  );

  const roleColor = (role?: Role) =>
    role === "admin"
      ? "bg-red-100 text-red-800"
      : role === "tutor"
      ? "bg-blue-100 text-blue-800"
      : "bg-green-100 text-green-800";

  const canShowPublic =
    me?.user?.role === "tutor" &&
    !!me?.tutorProfile?.id &&
    !!me?.tutorProfile?.isVerified &&
    !!me?.tutorProfile?.isActive;

  const unreadBadgeText = unread > 99 ? "99+" : unread.toString();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 gradient-header shadow-lg">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo -> always dashboard "/" */}
          <Link
            href="/"
            className="flex items-center space-x-2 text-white hover:text-gray-200"
          >
            <i className="fas fa-graduation-cap text-2xl" />
            <span className="text-xl font-bold">Daresni</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center space-x-8">
            {desktopNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${
                  location === item.href
                    ? "bg-white/20 text-white"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
                data-testid={`nav-link-${item.label
                  .toLowerCase()
                  .replace(/\s+/g, "-")}`}
              >
                <i className={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}

            {/* Public profile visible only when tutor is verified + active */}
            {canShowPublic && (
              <Link
                href={`/tutors/${me!.tutorProfile!.id}`}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${
                  location?.startsWith("/tutors/")
                    ? "bg-white/20 text-white"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
                data-testid="nav-link-public-profile"
              >
                <i className="fas fa-id-badge" />
                <span>Public Profile</span>
              </Link>
            )}
          </div>

          {/* User section */}
          <div className="flex items-center space-x-4">
            {user?.role && (
              <Badge
                className={roleColor(user.role)}
                data-testid="badge-user-role"
              >
                {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
              </Badge>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-10 w-10 rounded-full"
                  data-testid="button-user-menu"
                  aria-label={`Open user menu${
                    unread > 0 ? `, ${unread} unread notifications` : ""
                  }`}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage
                      src={user?.profileImageUrl || undefined}
                      alt={user?.firstName || "User"}
                    />
                    <AvatarFallback className="bg-white/20 text-white">
                      {(user?.firstName?.[0] || "").toUpperCase()}
                      {(user?.lastName?.[0] || "").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  {unread > 0 && (
                    <span
                      aria-live="polite"
                      className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1.5 rounded-full border border-white bg-red-600 text-white text-[10px] leading-[18px] font-bold flex items-center justify-center shadow-sm"
                      data-testid="badge-unread-count"
                      title={`${unread} unread notifications`}
                    >
                      {unreadBadgeText}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent className="w-72" align="end" forceMount>
                {/* Profile Header */}
                <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950">
                  <Avatar className="h-12 w-12 border-2 border-white">
                    <AvatarImage
                      src={user?.profileImageUrl || undefined}
                      alt={user?.firstName || "User"}
                    />
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white">
                      {(user?.firstName?.[0] || "").toUpperCase()}
                      {(user?.lastName?.[0] || "").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email}
                    </p>
                  </div>
                </div>

                <DropdownMenuSeparator />

                {/* Navigation Section */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Navigation
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => navigate("/")}
                    data-testid="menu-item-dashboard"
                  >
                    <Home className="mr-2 h-4 w-4" />
                    Dashboard
                  </DropdownMenuItem>

                  {me?.user?.role === "student" && (
                    <DropdownMenuItem
                      onClick={() => navigate("/tutors")}
                      data-testid="menu-item-find-tutors"
                    >
                      <Search className="mr-2 h-4 w-4" />
                      Find Tutors
                    </DropdownMenuItem>
                  )}

                  {canShowPublic && (
                    <DropdownMenuItem
                      onClick={() =>
                        navigate(`/tutors/${me!.tutorProfile!.id}`)
                      }
                      data-testid="menu-item-public-profile"
                    >
                      <IdCard className="mr-2 h-4 w-4" />
                      Public Profile
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                {/* Learning Section */}
                {me?.user?.role === "student" && (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <GraduationCap className="inline mr-1.5 h-3.5 w-3.5" />
                        Learning
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => navigate("/my-sessions")}
                        data-testid="menu-item-my-sessions"
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        My Sessions
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => navigate("/calendar")}
                        data-testid="menu-item-calendar"
                      >
                        <Calendar className="mr-2 h-4 w-4 text-blue-500" />
                        Calendar View
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => navigate("/student-reports")}
                        data-testid="menu-item-student-reports"
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Lesson Reports
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          // Open AI Study Buddy
                          const event = new CustomEvent("open-study-buddy");
                          window.dispatchEvent(event);
                        }}
                        data-testid="menu-item-ai-study-buddy"
                      >
                        <Sparkles className="mr-2 h-4 w-4 text-purple-500" />
                        <span className="flex-1">AI Study Buddy</span>
                        <Badge variant="secondary" className="text-xs">
                          Free
                        </Badge>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>

                    <DropdownMenuSeparator />

                    {/* Games Section */}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <Gamepad2 className="inline mr-1.5 h-3.5 w-3.5" />
                        Mini Games
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => {
                          // Open memory match game
                          const event = new CustomEvent("open-memory-game");
                          window.dispatchEvent(event);
                        }}
                        data-testid="menu-item-memory-game"
                      >
                        <i className="fas fa-brain mr-2 w-4" />
                        Memory Match
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          // Future: Add more games
                          toast({
                            title: "Coming Soon!",
                            description: "More games will be available soon.",
                          });
                        }}
                        data-testid="menu-item-more-games"
                        className="text-muted-foreground"
                      >
                        <Gamepad2 className="mr-2 h-4 w-4" />
                        More Games
                        <Badge variant="outline" className="ml-auto text-xs">
                          Soon
                        </Badge>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>

                    <DropdownMenuSeparator />
                  </>
                )}

                {/* For Tutors */}
                {me?.user?.role === "tutor" && (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Teaching
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => navigate("/my-sessions")}
                        data-testid="menu-item-my-sessions"
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        My Sessions
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => navigate("/calendar")}
                        data-testid="menu-item-calendar"
                      >
                        <Calendar className="mr-2 h-4 w-4 text-blue-500" />
                        Calendar View
                      </DropdownMenuItem>
                    </DropdownMenuGroup>

                    <DropdownMenuSeparator />

                    {/* Games Section for Tutors */}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <Gamepad2 className="inline mr-1.5 h-3.5 w-3.5" />
                        Mini Games
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => {
                          // Open memory match game
                          const event = new CustomEvent("open-memory-game");
                          window.dispatchEvent(event);
                        }}
                        data-testid="menu-item-memory-game-tutor"
                      >
                        <i className="fas fa-brain mr-2 w-4" />
                        Memory Match
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          // Future: Add more games
                          toast({
                            title: "Coming Soon!",
                            description: "More games will be available soon.",
                          });
                        }}
                        data-testid="menu-item-more-games-tutor"
                        className="text-muted-foreground"
                      >
                        <Gamepad2 className="mr-2 h-4 w-4" />
                        More Games
                        <Badge variant="outline" className="ml-auto text-xs">
                          Soon
                        </Badge>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>

                    <DropdownMenuSeparator />
                  </>
                )}

                {/* Settings Section */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Settings
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => navigate("/profile-settings")}
                    data-testid="menu-item-profile"
                  >
                    <User className="mr-2 h-4 w-4" />
                    Profile Settings
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onClick={() => navigate("/notifications")}
                    data-testid="menu-item-notifications"
                  >
                    <Bell className="mr-2 h-4 w-4" />
                    Notifications
                    {unread > 0 && (
                      <Badge variant="destructive" className="ml-auto text-xs">
                        {unreadBadgeText}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:text-destructive"
                  data-testid="menu-item-logout"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mobile menu toggle */}
            <Button
              variant="ghost"
              className="md:hidden text-white hover:text-gray-200 hover:bg-white/10"
              onClick={() => setIsMobileMenuOpen((v) => !v)}
              data-testid="button-mobile-menu"
            >
              <i
                className={`fas ${
                  isMobileMenuOpen ? "fa-times" : "fa-bars"
                } text-xl`}
              />
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-white/20 py-4">
            <div className="space-y-2">
              {desktopNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-md transition-colors ${
                    location === item.href
                      ? "bg-white/20 text-white"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                  data-testid={`mobile-nav-link-${item.label
                    .toLowerCase()
                    .replace(/\s+/g, "-")}`}
                >
                  <i className={item.icon} />
                  <span>{item.label}</span>
                </Link>
              ))}

              {canShowPublic && (
                <Link
                  href={`/tutors/${me!.tutorProfile!.id}`}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-md transition-colors ${
                    location?.startsWith("/tutors/")
                      ? "bg-white/20 text-white"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`}
                  onClick={() => setIsMobileMenuOpen(false)}
                  data-testid="mobile-nav-link-public-profile"
                >
                  <i className="fas fa-id-badge" />
                  <span>Public Profile</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
