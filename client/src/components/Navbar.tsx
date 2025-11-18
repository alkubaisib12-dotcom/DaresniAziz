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
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";

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
    refetchInterval: 15_000,
    staleTime: 10_000,
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

              <DropdownMenuContent className="w-56" align="end" forceMount>
                <div className="flex items-center justify-start gap-2 p-2">
                  <div className="flex flex-col space-y-1 leading-none">
                    <p className="font-medium">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="w-[200px] truncate text-sm text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => navigate("/")}
                  data-testid="menu-item-dashboard"
                >
                  <i className="fas fa-home mr-2" />
                  Dashboard
                </DropdownMenuItem>

                {me?.user?.role === "student" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => navigate("/tutors")}
                      data-testid="menu-item-find-tutors"
                    >
                      <i className="fas fa-search mr-2" />
                      Find Tutors
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigate("/my-sessions")}
                      data-testid="menu-item-my-sessions"
                    >
                      <i className="fas fa-calendar mr-2" />
                      My Sessions
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => navigate("/student-reports")}
                      data-testid="menu-item-student-reports"
                    >
                      <i className="fas fa-file-alt mr-2" />
                      Lesson Reports
                    </DropdownMenuItem>
                  </>
                )}

                {me?.user?.role === "tutor" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => navigate("/my-sessions")}
                      data-testid="menu-item-my-sessions"
                    >
                      <i className="fas fa-calendar mr-2" />
                      My Sessions
                    </DropdownMenuItem>
                    {canShowPublic && (
                      <DropdownMenuItem
                        onClick={() =>
                          navigate(`/tutors/${me!.tutorProfile!.id}`)
                        }
                        data-testid="menu-item-public-profile"
                      >
                        <i className="fas fa-id-badge mr-2" />
                        View Public Profile
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                <DropdownMenuItem
                  onClick={() => navigate("/profile-settings")}
                  data-testid="menu-item-profile"
                >
                  <i className="fas fa-user mr-2" />
                  Profile Settings
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => navigate("/notifications")}
                  data-testid="menu-item-notifications"
                >
                  <i className="fas fa-bell mr-2" />
                  Notifications
                  {unread > 0 && (
                    <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                      {unreadBadgeText}
                    </span>
                  )}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-destructive focus:text-destructive"
                  data-testid="menu-item-logout"
                >
                  <i className="fas fa-sign-out-alt mr-2" />
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
