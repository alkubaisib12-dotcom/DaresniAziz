import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatMoney } from "@/lib/currency";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { CreateSession, SessionStatus } from "@shared/types";
import { AlertCircle } from "lucide-react";

type BookingModalProps = {
  tutor: any;
  onClose: () => void;
  onConfirm: () => void;
};

type CreateSessionPayload = Omit<CreateSession, "scheduledAt"> & {
  scheduledAt: string;
};

type Slot = { start: string; end: string; available: boolean; at: string };

// Match server DAY_KEYS order: 0 = sunday, 1 = monday, ...
const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
type DayKey = (typeof DAY_KEYS)[number];
const toDayKey = (d: Date): DayKey => DAY_KEYS[d.getDay()];

async function postSession(payload: CreateSessionPayload) {
  try {
    console.log("📤 Posting session:", payload);

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Server error:", data);
      throw new Error(data?.message || `Failed to book session (${response.status})`);
    }

    console.log("✅ Session booked:", data);
    return data;
  } catch (error: any) {
    console.error("❌ Session booking error:", error);
    throw error;
  }
}

export function BookingModal({ tutor, onClose, onConfirm }: BookingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>("");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  // Track specific calendar dates that turned out to have no available slots
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());

  const hourlyRate = Number(tutor?.hourlyRate ?? 15);

  // Calculate duration from selected slots
  const duration = useMemo(() => {
    if (selectedSlots.length === 0) return 60;
    return selectedSlots.length * 60; // each slot is 60 minutes
  }, [selectedSlots]);

  const sessionCost = useMemo(() => hourlyRate * (duration / 60), [hourlyRate, duration]);
  const platformFee = useMemo(() => sessionCost * 0.1, [sessionCost]);
  const totalPrice = useMemo(() => sessionCost + platformFee, [sessionCost, platformFee]);

  // Fetch availability for selected date
  useEffect(() => {
    async function load() {
      if (!selectedDate || !tutor?.id) return;

      try {
        setLoadingSlots(true);
        setSlotsError(null);

        const yyyy_mm_dd = format(selectedDate, "yyyy-MM-dd");
        const path = `/api/tutors/${encodeURIComponent(
          tutor.id
        )}/availability?date=${yyyy_mm_dd}&step=60`;

        const res = await fetch(path, { credentials: "include" });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error || "Failed to fetch availability");
        }

        const serverSlots: Slot[] = Array.isArray(data?.slots) ? data.slots : [];
        setSlots(serverSlots);

        // If this date has no available slots, mark it as unavailable
        if (serverSlots.length === 0 || serverSlots.every((s) => !s.available)) {
          setUnavailableDates((prev) => {
            const next = new Set(prev);
            next.add(yyyy_mm_dd);
            return next;
          });
        }

        // Clear selected slots if they're no longer available
        setSelectedSlots((prev) =>
          prev.filter((slot) => serverSlots.some((s) => s.available && s.start === slot))
        );
      } catch (e: any) {
        console.error("❌ Availability fetch error:", e);
        setSlotsError(e?.message || "Failed to load availability");
        setSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    }
    load();
  }, [tutor?.id, selectedDate]);

  // Disable dates:
  // - Past dates
  // - Weekdays where tutor.availability[key].isAvailable === false
  // - Concrete dates we already know are fully unavailable (unavailableDates)
  const isDateDisabled = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const candidate = new Date(date);
    candidate.setHours(0, 0, 0, 0);

    // Disable past dates
    if (candidate < today) return true;

    // Disable full off-days based on weekly availability (matches server DAY_KEYS / toDayKey)
    const key = toDayKey(candidate);
    const weeklyAvailability = (tutor as any)?.availability;
    if (weeklyAvailability) {
      const dayAvail = weeklyAvailability[key];
      if (!dayAvail || dayAvail.isAvailable === false) {
        return true;
      }
    }

    // Disable dates we already discovered as having no slots
    const yyyy_mm_dd = format(candidate, "yyyy-MM-dd");
    if (unavailableDates.has(yyyy_mm_dd)) return true;

    return false;
  };

  // Toggle slot selection
  const toggleSlot = (slotStart: string) => {
    setSelectedSlots((prev) => {
      if (prev.includes(slotStart)) {
        return prev.filter((s) => s !== slotStart);
      } else {
        return [...prev, slotStart].sort();
      }
    });
  };

  const m = useMutation({
    mutationFn: (payload: CreateSessionPayload) => postSession(payload),

    onSuccess: (created: any) => {
      console.log("✅ Booking successful:", created);

      toast({
        title: "Success",
        description: "Session request sent to the tutor. It will appear as pending until accepted.",
        duration: 3000,
      });

      // Refresh tutor & student views
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] }); // TutorDashboard
      queryClient.invalidateQueries({ queryKey: ["studentSessions"] }); // StudentDashboard
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["my-sessions"] });

      onConfirm();
    },

    onError: (err: any) => {
      console.error("❌ Booking mutation error:", err);
      toast({
        title: "Booking failed",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleBooking = () => {
    if (!user?.id) {
      toast({
        title: "Sign in required",
        description: "Please sign in first.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedDate || selectedSlots.length === 0) {
      toast({
        title: "Missing info",
        description: "Please select at least one time slot.",
        variant: "destructive",
      });
      return;
    }

    // Use the first selected slot as the start time
    const firstSlot = [...selectedSlots].sort()[0];
    const [hh, mm] = firstSlot.split(":").map((n) => parseInt(n, 10));
    const scheduledAt = new Date(selectedDate);
    scheduledAt.setHours(hh, mm, 0, 0);

    const tutorProfileId: string = String(tutor?.id || "");
    const subjectId = tutor?.subjects?.[0]?.id ?? tutor?.subjects?.[0] ?? "general";

    const payload: CreateSessionPayload = {
      studentId: user.id,
      tutorId: tutorProfileId,
      subjectId,
      scheduledAt: scheduledAt.toISOString(),
      duration,
      notes,
      meetingLink: undefined,
      priceCents: Math.round(sessionCost * 100),
      status: "pending" as SessionStatus, // request starts as pending
    };

    console.log("📤 Booking session with payload:", payload);
    m.mutate(payload);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="modal-booking">
        <DialogHeader>
          <DialogTitle>Book a Session</DialogTitle>
        </DialogHeader>

        {/* Warning for tutor users */}
        {user?.role === "tutor" && (
          <Alert className="bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-800">
            <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-400">
              You are logged in as a tutor account. Only students can book sessions.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          {/* Tutor Info */}
          <div className="flex items-center space-x-4 p-4 bg-secondary rounded-lg">
            <Avatar className="w-16 h-16">
              <AvatarImage src={tutor?.user?.profileImageUrl ?? ""} alt={tutor?.user?.firstName ?? "Tutor"} />
              <AvatarFallback>
                {(tutor?.user?.firstName?.[0] ?? "T")}
                {tutor?.user?.lastName?.[0] ?? ""}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="font-semibold text-lg" data-testid="text-tutor-name">
                {tutor?.user?.firstName} {tutor?.user?.lastName}
              </h3>
              <p className="text-muted-foreground">
                {(tutor?.subjects ?? [])
                  .map((s: any) => (typeof s === "string" ? s : s.name))
                  .join(", ")}
              </p>
              <div className="flex items-center space-x-2 mt-1">
                <Badge variant="outline" className="bg-primary/10 text-primary">
                    {formatMoney(hourlyRate)}/hour

                </Badge>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Date Selection */}
            <div>
              <Label className="text-base font-medium">Select Date</Label>
              <div className="mt-2">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={isDateDisabled}
                  className="rounded-md border"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Unavailable days are greyed out and cannot be selected.
              </p>
            </div>

            {/* Time Selection */}
            <div>
              <Label className="text-base font-medium">
                Available Times
                {selectedSlots.length > 0 && (
                  <span className="ml-2 text-sm text-primary">
                    ({selectedSlots.length} slot{selectedSlots.length > 1 ? "s" : ""} selected)
                  </span>
                )}
              </Label>
              <div className="mt-2 min-h-[200px] max-h-[300px] overflow-y-auto">
                {loadingSlots ? (
                  <div className="text-sm text-muted-foreground flex items-center justify-center py-8">
                    <i className="fas fa-spinner fa-spin mr-2" />
                    Loading slots…
                  </div>
                ) : slotsError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{slotsError}</AlertDescription>
                  </Alert>
                ) : slots.length === 0 ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No available times for this date. Please select another date.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {slots.map((s) => (
                      <Button
                        key={s.start}
                        variant={selectedSlots.includes(s.start) ? "default" : "outline"}
                        size="sm"
                        onClick={() => s.available && toggleSlot(s.start)}
                        disabled={!s.available}
                        data-testid={`button-time-${s.start}`}
                        className={
                          selectedSlots.includes(s.start)
                            ? "bg-primary"
                            : !s.available
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }
                      >
                        {s.start} - {s.end}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                💡 Click multiple slots for longer sessions
              </p>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes" className="text-base font-medium">
              Session Notes (Optional)
            </Label>
            <Textarea
              id="notes"
              placeholder="What would you like to focus on in this session?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-2"
              rows={3}
              data-testid="textarea-notes"
            />
          </div>

          {/* Booking Summary */}
          <div className="bg-secondary rounded-lg p-4">
            <h4 className="font-semibold mb-3">Booking Summary</h4>
            <div className="space-y-2 text-sm">
              {selectedDate && selectedSlots.length > 0 && (
                <>
                  <div className="flex justify-between">
                    <span>Date & Time:</span>
                    <span className="font-medium">
                      {format(selectedDate, "MMM dd, yyyy")} at {selectedSlots.sort()[0]}
                    </span>
                  </div>
                  {selectedSlots.length > 1 && (
                    <div className="flex justify-between">
                      <span>Time Slots:</span>
                      <span className="font-medium text-xs">
                        {selectedSlots.sort().join(", ")}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between">
                <span>Duration:</span>
                <span className="font-medium">
                  {duration} minutes ({duration / 60} hour{duration > 60 ? "s" : ""})
                </span>
              </div>
              <div className="flex justify-between">
                <span>Hourly Rate:</span>
                <span className="font-medium">{formatMoney(hourlyRate)}/hour</span>
              </div>
              <div className="flex justify-between">
                <span>Session Cost:</span>
                <span className="font-medium">{formatMoney(sessionCost)}
</span>
              </div>
              <div className="flex justify-between">
                <span>Platform Fee (10%):</span>
                <span className="font-medium">{formatMoney(platformFee)}
</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-semibold">
                <span>Total:</span>
<span data-testid="text-total-price">
  {formatMoney(totalPrice)}
</span>              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBooking}
              disabled={m.isPending || !selectedDate || selectedSlots.length === 0 || user?.role === "tutor"}
              className="flex-1 btn-primary"
              data-testid="button-confirm-booking"
            >
              {m.isPending ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2" />
                  Booking...
                </>
              ) : (
                <>
  <i className="fas fa-credit-card mr-2" />
  Confirm &amp; Pay {formatMoney(totalPrice)}
</>

              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
