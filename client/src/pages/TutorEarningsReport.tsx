// client/src/pages/TutorEarningsReport.tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";

import type { Session, TutorProfile, User, Subject } from "@shared/schema";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/currency";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

/* ---------- Types & helpers ---------- */

type SessionWithRelations = Session & {
  student: User;
  tutor: TutorProfile & { user: User };
  subject: Subject;
};

function toDate(value: any): Date | null {
  try {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

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

function getSessionAmount(s: any): number {
  if (typeof s.priceCents === "number") return s.priceCents / 100;
  if (typeof s.price === "string") return parseFloat(s.price || "0");
  if (typeof s.price === "number") return s.price;
  return 0;
}

type RangeKey = "all" | "30" | "90" | "365";

export default function TutorEarningsReport() {
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [range, setRange] = useState<RangeKey>("30");

  const { data: sessions, isLoading: sessionsLoading } = useQuery<
    SessionWithRelations[]
  >({
    queryKey: ["/api/sessions"],
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: true,
  });

  // Guard: unauthenticated
  if (!isLoading && !user) {
    toast({
      title: "Unauthorized",
      description: "Please sign in to view your earnings report.",
      variant: "destructive",
    });
    navigate("/", { replace: true });
    return null;
  }

  const completedSessions = useMemo(
    () =>
      (Array.isArray(sessions) ? sessions : []).filter(
        (s) => s.status === "completed",
      ),
    [sessions],
  );

  // Filter by time range
  const filteredSessions = useMemo(() => {
    if (range === "all") return completedSessions;
    const days = range === "30" ? 30 : range === "90" ? 90 : 365;

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - days + 1);

    return completedSessions.filter((s) => {
      const dt = toDate(s.scheduledAt);
      if (!dt) return false;
      const d = new Date(dt);
      d.setHours(0, 0, 0, 0);
      return d >= cutoff && d <= now;
    });
  }, [completedSessions, range]);

  const totalEarnings = useMemo(
    () => filteredSessions.reduce((sum, s) => sum + getSessionAmount(s), 0),
    [filteredSessions],
  );

  const totalMinutes = useMemo(
    () =>
      filteredSessions.reduce(
        (sum, s: any) =>
          sum + (typeof s.duration === "number" ? s.duration : 60),
        0,
      ),
    [filteredSessions],
  );

  const totalHours = useMemo(
    () => Math.round((totalMinutes / 60) * 10) / 10,
    [totalMinutes],
  );

  const averagePerHour = useMemo(() => {
    if (totalHours <= 0) return 0;
    return totalEarnings / totalHours;
  }, [totalEarnings, totalHours]);

  const uniqueStudentsCount = useMemo(() => {
    const ids = new Set<string>();
    for (const s of filteredSessions) {
      if (s.studentId) ids.add(String(s.studentId));
    }
    return ids.size;
  }, [filteredSessions]);

  // Earnings by subject
  const earningsBySubject = useMemo(() => {
    const map = new Map<string, {
      name: string;
      earnings: number;
      sessions: number;
      color: string
    }>();

    const colors = [
      "hsl(var(--chart-1))",
      "hsl(var(--chart-2))",
      "hsl(var(--chart-3))",
      "hsl(var(--chart-4))",
      "hsl(var(--chart-5))",
    ];

    filteredSessions.forEach((s) => {
      const subjectName = s.subject?.name || "Unknown Subject";
      const amount = getSessionAmount(s);

      const current = map.get(subjectName) || {
        name: subjectName,
        earnings: 0,
        sessions: 0,
        color: colors[map.size % colors.length]
      };

      current.earnings += amount;
      current.sessions += 1;
      map.set(subjectName, current);
    });

    return Array.from(map.values()).sort((a, b) => b.earnings - a.earnings);
  }, [filteredSessions]);

  // Success rate by status
  const sessionsByStatus = useMemo(() => {
    const allSessionsInRange = (Array.isArray(sessions) ? sessions : []).filter((s) => {
      if (range === "all") return true;
      const days = range === "30" ? 30 : range === "90" ? 90 : 365;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const cutoff = new Date(now);
      cutoff.setDate(now.getDate() - days + 1);
      const dt = toDate(s.scheduledAt);
      if (!dt) return false;
      const d = new Date(dt);
      d.setHours(0, 0, 0, 0);
      return d >= cutoff && d <= now;
    });

    const statusCounts = {
      completed: allSessionsInRange.filter(s => s.status === "completed").length,
      cancelled: allSessionsInRange.filter(s => s.status === "cancelled").length,
      scheduled: allSessionsInRange.filter(s => s.status === "scheduled").length,
      in_progress: allSessionsInRange.filter(s => s.status === "in_progress").length,
    };

    return statusCounts;
  }, [sessions, range]);

  // Chart data: daily points over the selected range (including 0 days)
  const chartData = useMemo(() => {
    if (!filteredSessions.length && range !== "all") {
      // Even if there are no sessions, still show flat 0 line for chosen range
      const days = range === "30" ? 30 : range === "90" ? 90 : 365;
      const end = new Date();
      end.setHours(0, 0, 0, 0);
      const start = new Date(end);
      start.setDate(end.getDate() - days + 1);

      const data: { date: string; value: number }[] = [];
      const cursor = new Date(start);

      while (cursor <= end) {
        data.push({
          date: format(cursor, "MMM dd"),
          value: 0,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      return data;
    }

    // Map: yyyy-mm-dd -> total earnings that day (from filteredSessions)
    const map = new Map<string, number>();
    for (const s of filteredSessions) {
      const dt = toDate(s.scheduledAt);
      if (!dt) continue;
      const day = new Date(dt);
      day.setHours(0, 0, 0, 0);
      const key = day.toISOString().slice(0, 10);

      const current = map.get(key) ?? 0;
      map.set(key, current + getSessionAmount(s));
    }

    let start: Date;
    let end: Date;

    if (range === "all") {
      // For "all", span from earliest to latest completed session
      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      for (const s of filteredSessions) {
        const dt = toDate(s.scheduledAt);
        if (!dt) continue;
        const d = new Date(dt);
        d.setHours(0, 0, 0, 0);
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }

      if (!minDate || !maxDate) return [];

      start = new Date(minDate);
      end = new Date(maxDate);
    } else {
      const days = range === "30" ? 30 : range === "90" ? 90 : 365;
      end = new Date();
      end.setHours(0, 0, 0, 0);
      start = new Date(end);
      start.setDate(end.getDate() - days + 1);
    }

    const result: { date: string; value: number }[] = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const totalForDay = map.get(key) ?? 0;
      result.push({
        date: format(cursor, "MMM dd"),
        value: Number(totalForDay.toFixed(3)),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }, [filteredSessions, range]);

  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Earnings Report
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Detailed view of your completed sessions and earnings.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => navigate("/tutor-dashboard")}
          >
            <i className="fas fa-arrow-left mr-2" />
            Back to Dashboard
          </Button>
        </div>

        {/* Range filter */}
        <div className="mb-6">
          <div className="inline-flex gap-2">
            <Button
              size="sm"
              variant={range === "30" ? "default" : "outline"}
              onClick={() => setRange("30")}
            >
              Last 30 days
            </Button>
            <Button
              size="sm"
              variant={range === "90" ? "default" : "outline"}
              onClick={() => setRange("90")}
            >
              Last 90 days
            </Button>
            <Button
              size="sm"
              variant={range === "365" ? "default" : "outline"}
              onClick={() => setRange("365")}
            >
              Last 12 months
            </Button>
            <Button
              size="sm"
              variant={range === "all" ? "default" : "outline"}
              onClick={() => setRange("all")}
            >
              All time
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-6 text-center">
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Total Earnings
              </div>
              <div className="text-2xl font-bold text-primary">
                {formatMoney(totalEarnings)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 text-center">
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Completed Sessions
              </div>
              <div className="text-2xl font-bold">
                {filteredSessions.length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 text-center">
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Total Hours
              </div>
              <div className="text-2xl font-bold">{totalHours}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 text-center">
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Avg. per Hour
              </div>
              <div className="text-2xl font-bold text-primary">
                {formatMoney(averagePerHour)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Earnings chart: Date vs Money, daily points including 0 days */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Earnings Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                No earnings data for this period.
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                    />
                    <Tooltip
                      formatter={(value: any) => [
                        formatMoney(Number(value)),
                        "Earnings",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Session Success Rate */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Session Status Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Completed
                </div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {sessionsByStatus.completed}
                </div>
                <Badge variant="outline" className="mt-2 bg-green-100 dark:bg-green-900">
                  <i className="fas fa-check-circle mr-1" />
                  Successful
                </Badge>
              </div>
              <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Scheduled
                </div>
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {sessionsByStatus.scheduled}
                </div>
                <Badge variant="outline" className="mt-2 bg-blue-100 dark:bg-blue-900">
                  <i className="fas fa-calendar mr-1" />
                  Upcoming
                </Badge>
              </div>
              <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  In Progress
                </div>
                <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {sessionsByStatus.in_progress}
                </div>
                <Badge variant="outline" className="mt-2 bg-yellow-100 dark:bg-yellow-900">
                  <i className="fas fa-spinner mr-1" />
                  Active
                </Badge>
              </div>
              <div className="text-center p-4 bg-red-50 dark:bg-red-950 rounded-lg">
                <div className="text-xs uppercase text-muted-foreground mb-1">
                  Cancelled
                </div>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {sessionsByStatus.cancelled}
                </div>
                <Badge variant="outline" className="mt-2 bg-red-100 dark:bg-red-900">
                  <i className="fas fa-times-circle mr-1" />
                  Cancelled
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Earnings by Subject */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Earnings Breakdown by Subject</CardTitle>
          </CardHeader>
          <CardContent>
            {earningsBySubject.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                No subject data available for this period.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Bar Chart */}
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={earningsBySubject}
                      margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <Tooltip
                        formatter={(value: any) => [
                          formatMoney(Number(value)),
                          "Earnings",
                        ]}
                      />
                      <Bar dataKey="earnings" radius={[8, 8, 0, 0]}>
                        {earningsBySubject.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Detailed Breakdown Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-2 text-left">Subject</th>
                        <th className="py-2 text-right">Sessions</th>
                        <th className="py-2 text-right">Total Earnings</th>
                        <th className="py-2 text-right">Avg per Session</th>
                        <th className="py-2 text-right">% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earningsBySubject.map((subject, index) => {
                        const avgPerSession = subject.earnings / subject.sessions;
                        const percentage = totalEarnings > 0
                          ? (subject.earnings / totalEarnings) * 100
                          : 0;
                        return (
                          <tr key={index} className="border-b last:border-b-0">
                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: subject.color }}
                                />
                                <span className="font-medium">{subject.name}</span>
                              </div>
                            </td>
                            <td className="py-3 text-right">{subject.sessions}</td>
                            <td className="py-3 text-right font-semibold">
                              {formatMoney(subject.earnings)}
                            </td>
                            <td className="py-3 text-right text-muted-foreground">
                              {formatMoney(avgPerSession)}
                            </td>
                            <td className="py-3 text-right">
                              <Badge variant="outline">
                                {percentage.toFixed(1)}%
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Students summary */}
        <div className="mb-6">
          <Badge variant="outline">
            {uniqueStudentsCount} unique student
            {uniqueStudentsCount === 1 ? "" : "s"} in this period
          </Badge>
        </div>

        {/* Sessions table */}
        <Card>
          <CardHeader>
            <CardTitle>Completed Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-10 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">
                No completed sessions for this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 text-left">Date</th>
                      <th className="py-2 text-left">Student</th>
                      <th className="py-2 text-left">Subject</th>
                      <th className="py-2 text-center">Status</th>
                      <th className="py-2 text-right">Duration</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.map((s) => {
                      const dt = toDate(s.scheduledAt);
                      const amount = getSessionAmount(s);
                      const duration =
                        typeof s.duration === "number" ? s.duration : 60;
                      return (
                        <tr key={s.id} className="border-b last:border-b-0">
                          <td className="py-2">
                            {dt ? format(dt, "MMM dd, yyyy") : "TBD"}
                          </td>
                          <td className="py-2">
                            {s.student?.firstName} {s.student?.lastName}
                          </td>
                          <td className="py-2">{s.subject?.name}</td>
                          <td className="py-2 text-center">
                            <Badge
                              variant="outline"
                              className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                            >
                              <i className="fas fa-check-circle mr-1" />
                              Completed
                            </Badge>
                          </td>
                          <td className="py-2 text-right">{duration} min</td>
                          <td className="py-2 text-right font-semibold">
                            {formatMoney(amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
