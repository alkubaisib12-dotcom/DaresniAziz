import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingDown, BarChart3, DollarSign, PieChart as PieChartIcon } from "lucide-react";
import { formatMoney } from "@/lib/currency";

type Session = {
  id: string;
  scheduledAt: any;
  status: string;
  priceCents?: number;
  price?: string;
  duration?: number;
  subject?: { id: string; name: string };
  location?: string;
  sessionType?: string;
};

type TutorAnalyticsSectionProps = {
  sessions: Session[];
};

const COLORS = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444"];

function toDate(value: any): Date | null {
  try {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === "object") {
      if (typeof (value as any).toDate === "function") {
        const d = (value as any).toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      }
      if (typeof (value as any)._seconds === "number") {
        const d = new Date((value as any)._seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default function TutorAnalyticsSection({ sessions }: TutorAnalyticsSectionProps) {
  // Process data for analytics
  const analytics = useMemo(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 24 * 60 * 60 * 1000);

    // Filter completed and scheduled sessions for last 30 days
    const recentSessions = sessions.filter((s) => {
      const date = toDate(s.scheduledAt);
      return (
        date &&
        date >= thirtyDaysAgo &&
        (s.status === "completed" || s.status === "scheduled")
      );
    });

    // 1. Bookings per subject (last 30 days)
    const subjectBookings: Record<string, number> = {};
    recentSessions.forEach((s) => {
      if (s.subject?.name) {
        subjectBookings[s.subject.name] = (subjectBookings[s.subject.name] || 0) + 1;
      }
    });

    const subjectData = Object.entries(subjectBookings)
      .map(([name, count]) => ({ name, bookings: count }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 8); // Top 8 subjects

    // 2. Weekly earnings (last 8 weeks)
    const weeklyEarnings: Record<string, number> = {};
    const completedSessions = sessions.filter((s) => s.status === "completed");

    completedSessions.forEach((s) => {
      const date = toDate(s.scheduledAt);
      if (!date || date < eightWeeksAgo) return;

      // Calculate week number from eightWeeksAgo
      const weeksDiff = Math.floor((date.getTime() - eightWeeksAgo.getTime()) / (7 * 24 * 60 * 60 * 1000));
      const weekKey = `Week ${weeksDiff + 1}`;

      const earnings =
        typeof s.priceCents === "number"
          ? s.priceCents / 100
          : typeof s.price === "string"
          ? parseFloat(s.price || "0")
          : 0;

      weeklyEarnings[weekKey] = (weeklyEarnings[weekKey] || 0) + earnings;
    });

    // Ensure all 8 weeks are present
    const earningsData = Array.from({ length: 8 }, (_, i) => {
      const weekKey = `Week ${i + 1}`;
      return {
        week: weekKey,
        earnings: weeklyEarnings[weekKey] || 0,
      };
    });

    // 3. Session types distribution (online vs in-person)
    const sessionTypes: Record<string, number> = {};
    recentSessions.forEach((s) => {
      const type = s.location?.toLowerCase().includes("online") || s.sessionType?.toLowerCase().includes("online")
        ? "Online"
        : s.location?.toLowerCase().includes("person") || s.sessionType?.toLowerCase().includes("person")
        ? "In-Person"
        : "Other";

      sessionTypes[type] = (sessionTypes[type] || 0) + 1;
    });

    const sessionTypeData = Object.entries(sessionTypes).map(([name, value]) => ({
      name,
      value,
    }));

    // 4. Low-performing subjects (less than 3 bookings in last 30 days)
    const lowPerformingThreshold = 3;
    const lowPerformingSubjects = Object.entries(subjectBookings)
      .filter(([_, count]) => count < lowPerformingThreshold)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.count - b.count);

    return {
      subjectData,
      earningsData,
      sessionTypeData,
      lowPerformingSubjects,
      totalRecentBookings: recentSessions.length,
      hasSessionTypes: sessionTypeData.length > 0,
    };
  }, [sessions]);

  const totalEarnings = analytics.earningsData.reduce((sum, w) => sum + w.earnings, 0);

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center space-x-2 mb-4">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold text-foreground">Enhanced Analytics</h2>
      </div>

      {/* Stats Overview */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-primary/10 p-3 rounded-full">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last 30 Days</p>
                <p className="text-2xl font-bold">{analytics.totalRecentBookings}</p>
                <p className="text-xs text-muted-foreground">Total Bookings</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-green-500/10 p-3 rounded-full">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last 8 Weeks</p>
                <p className="text-2xl font-bold">{formatMoney(totalEarnings)}</p>
                <p className="text-xs text-muted-foreground">Total Earnings</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-amber-500/10 p-3 rounded-full">
                <TrendingDown className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Needs Attention</p>
                <p className="text-2xl font-bold">{analytics.lowPerformingSubjects.length}</p>
                <p className="text-xs text-muted-foreground">Low-Performing Subjects</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Bookings per Subject */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <BarChart3 className="h-5 w-5 mr-2 text-primary" />
              Bookings by Subject (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.subjectData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.subjectData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    className="text-xs"
                  />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="bookings" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No bookings in the last 30 days</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Weekly Earnings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <DollarSign className="h-5 w-5 mr-2 text-green-600" />
              Weekly Earnings (Last 8 Weeks)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {totalEarnings > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={analytics.earningsData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="week" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => formatMoney(value)}
                  />
                  <Line
                    type="monotone"
                    dataKey="earnings"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ fill: "#10b981", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No earnings in the last 8 weeks</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Pie Chart + Low Performing */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Session Types Distribution */}
        {analytics.hasSessionTypes && analytics.sessionTypeData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-lg">
                <PieChartIcon className="h-5 w-5 mr-2 text-primary" />
                Session Types Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={analytics.sessionTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name}: ${(percent * 100).toFixed(0)}%`
                    }
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {analytics.sessionTypeData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Low-Performing Subjects */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-lg">
              <TrendingDown className="h-5 w-5 mr-2 text-amber-600" />
              Low-Performing Subjects
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.lowPerformingSubjects.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground mb-4">
                  Subjects with fewer than 3 bookings in the last 30 days:
                </p>
                {analytics.lowPerformingSubjects.map((subject) => (
                  <div
                    key={subject.name}
                    className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="bg-amber-500/20 p-2 rounded-full">
                        <TrendingDown className="h-4 w-4 text-amber-600" />
                      </div>
                      <span className="font-medium">{subject.name}</span>
                    </div>
                    <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      {subject.count} booking{subject.count !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                ))}
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
                  <p className="text-xs text-blue-800 dark:text-blue-200 flex items-start">
                    <i className="fas fa-lightbulb mr-2 mt-0.5" />
                    <span>
                      Consider adjusting pricing, improving descriptions, or promoting
                      these subjects to increase bookings.
                    </span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-center text-muted-foreground">
                <div>
                  <i className="fas fa-check-circle text-4xl text-green-500 mb-3" />
                  <p className="text-sm font-medium">All subjects performing well!</p>
                  <p className="text-xs mt-1">
                    All your subjects have 3 or more bookings
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
