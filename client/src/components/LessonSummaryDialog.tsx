// client/src/components/LessonSummaryDialog.tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updateTutorNotes, generateAISummary } from "@/lib/api";
import type { ApiSession } from "@/lib/api";

interface LessonSummaryDialogProps {
  session: ApiSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LessonSummaryDialog({
  session,
  open,
  onOpenChange,
}: LessonSummaryDialogProps) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(session.tutorNotes || "");
  const [error, setError] = useState("");

  const updateNotesMutation = useMutation({
    mutationFn: (tutorNotes: string) => updateTutorNotes(session.id, tutorNotes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tutor/sessions"] });
    },
    onError: (err: any) => {
      setError(err.message || "Failed to save notes");
    },
  });

  const generateSummaryMutation = useMutation({
    mutationFn: () => generateAISummary(session.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tutor/sessions"] });
      setError("");
      // Show success message
      alert("AI summary generated successfully!");
    },
    onError: (err: any) => {
      setError(err.message || "Failed to generate summary");
    },
  });

  const handleSaveNotes = async () => {
    if (!notes.trim()) {
      setError("Please enter session notes");
      return;
    }
    updateNotesMutation.mutate(notes);
  };

  const handleGenerateSummary = async () => {
    if (!notes.trim()) {
      setError("Please save your notes first before generating a summary");
      return;
    }
    // Save notes first if they've been modified
    if (notes !== session.tutorNotes) {
      await updateNotesMutation.mutateAsync(notes);
    }
    // Then generate the summary
    generateSummaryMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lesson Summary</DialogTitle>
          <DialogDescription>
            Add your notes about the session, then generate an AI-powered summary for the student
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Session Info */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-semibold">Student:</span>{" "}
                {session.student?.firstName} {session.student?.lastName}
              </div>
              <div>
                <span className="font-semibold">Subject:</span> {session.subject?.name}
              </div>
              <div>
                <span className="font-semibold">Duration:</span> {session.duration || 60} minutes
              </div>
              <div>
                <span className="font-semibold">Status:</span> {session.status}
              </div>
            </div>
          </div>

          {/* Tutor Notes */}
          <div className="space-y-2">
            <Label htmlFor="tutor-notes">Your Session Notes</Label>
            <Textarea
              id="tutor-notes"
              placeholder="Describe what was covered in the session, the student's performance, areas they struggled with, and what they did well..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Be specific about topics covered, mistakes made, and strengths observed. The AI will
              use these notes to generate a structured summary.
            </p>
          </div>

          {/* AI Summary Preview (if exists) */}
          {session.aiSummary && (
            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <i className="fas fa-sparkles text-blue-600" />
                  AI-Generated Summary
                </h4>
                <span className="text-xs text-muted-foreground">
                  {session.aiSummary.generatedAt &&
                    new Date(
                      typeof session.aiSummary.generatedAt === "object" &&
                        "_seconds" in session.aiSummary.generatedAt
                        ? session.aiSummary.generatedAt._seconds * 1000
                        : session.aiSummary.generatedAt
                    ).toLocaleDateString()}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div>
                  <h5 className="font-semibold">What Was Learned:</h5>
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {session.aiSummary.whatWasLearned}
                  </p>
                </div>
                <div>
                  <h5 className="font-semibold">Mistakes & Areas for Improvement:</h5>
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {session.aiSummary.mistakes}
                  </p>
                </div>
                <div>
                  <h5 className="font-semibold">Strengths:</h5>
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {session.aiSummary.strengths}
                  </p>
                </div>
                <div>
                  <h5 className="font-semibold">Practice Tasks:</h5>
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {session.aiSummary.practiceTasks}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleSaveNotes}
            disabled={updateNotesMutation.isPending || !notes.trim()}
          >
            {updateNotesMutation.isPending ? (
              <>
                <i className="fas fa-spinner fa-spin mr-2" />
                Saving...
              </>
            ) : (
              <>
                <i className="fas fa-save mr-2" />
                Save Notes
              </>
            )}
          </Button>
          <Button
            onClick={handleGenerateSummary}
            disabled={
              generateSummaryMutation.isPending || updateNotesMutation.isPending || !notes.trim()
            }
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            {generateSummaryMutation.isPending ? (
              <>
                <i className="fas fa-spinner fa-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <i className="fas fa-sparkles mr-2" />
                Generate AI Summary
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
