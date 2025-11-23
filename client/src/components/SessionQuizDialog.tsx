// client/src/components/SessionQuizDialog.tsx
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { getSessionQuiz, submitQuizAnswers, type QuizQuestion } from "@/lib/api";

interface SessionQuizDialogProps {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SessionQuizDialog({
  sessionId,
  open,
  onOpenChange,
}: SessionQuizDialogProps) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState("");

  const {
    data: quizData,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: [`/api/sessions/${sessionId}/quiz`],
    queryFn: () => getSessionQuiz(sessionId),
    enabled: open,
  });

  // If student has already completed the quiz, show results
  useEffect(() => {
    if (quizData?.attempt) {
      setShowResults(true);
      setAnswers(quizData.attempt.answers);
    } else {
      setShowResults(false);
      setAnswers({});
    }
  }, [quizData]);

  const submitMutation = useMutation({
    mutationFn: () => submitQuizAnswers(sessionId, answers),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/sessions/${sessionId}/quiz`] });
      setShowResults(true);
      setError("");
    },
    onError: (err: any) => {
      setError(err.message || "Failed to submit quiz");
    },
  });

  const handleSubmit = () => {
    if (!quizData?.quiz) return;

    // Check if all questions are answered
    const unanswered = quizData.quiz.questions.some((_, index) => !answers[index]);
    if (unanswered) {
      setError("Please answer all questions before submitting");
      return;
    }

    submitMutation.mutate();
  };

  const handleRetake = () => {
    setAnswers({});
    setShowResults(false);
    setError("");
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Loading Quiz</DialogTitle>
            <DialogDescription>
              Please wait while we load your improvement quiz
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <i className="fas fa-spinner fa-spin text-4xl text-primary mb-3" />
              <p className="text-muted-foreground">Loading quiz...</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (fetchError || !quizData?.quiz) {
    const errorMessage = fetchError ? (fetchError as any).message : null;
    const isNotFound = errorMessage && errorMessage.includes("Quiz not found");

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quiz Not Available</DialogTitle>
            <DialogDescription>
              {isNotFound
                ? "The quiz hasn't been generated yet for this session"
                : "There was an issue loading the quiz for this session"}
            </DialogDescription>
          </DialogHeader>
          <div className="p-8 text-center text-muted-foreground">
            <i className={`fas ${isNotFound ? "fa-hourglass-half" : "fa-exclamation-circle"} text-4xl mb-3`} />
            <p className="font-semibold mb-2">
              {isNotFound
                ? "Quiz is being generated..."
                : "Failed to load quiz"}
            </p>
            <p className="text-sm">
              {isNotFound
                ? "The AI is creating a personalized quiz based on your lesson summary. This usually takes a few moments."
                : fetchError
                ? "There was an error connecting to the server. Please try again later."
                : "The quiz is being generated. Please check back in a moment."}
            </p>
            {isNotFound && (
              <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  💡 <strong>Tip:</strong> While you wait, check out your Study Buddy! Your tutor's lesson report has been added there, and you can ask questions about the topics you learned.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
            {isNotFound && (
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                className="ml-2"
              >
                <i className="fas fa-sync-alt mr-2" />
                Refresh
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const quiz = quizData.quiz;
  const attempt = quizData.attempt;

  // Results view (after submission or if already completed)
  if (showResults && attempt) {
    const scoreColor =
      attempt.score >= 80
        ? "text-green-600"
        : attempt.score >= 60
        ? "text-yellow-600"
        : "text-red-600";

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <i className="fas fa-check-circle text-green-600" />
              Quiz Results
            </DialogTitle>
            <DialogDescription>
              Review your answers and learn from the explanations
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Score Summary */}
            <div className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200">
              <div className="text-center">
                <div className={`text-5xl font-bold ${scoreColor} mb-2`}>
                  {attempt.score}%
                </div>
                <p className="text-lg font-semibold text-gray-700">
                  {attempt.correctCount} out of {attempt.totalQuestions} correct
                </p>
                {attempt.score >= 80 && (
                  <p className="text-green-600 mt-2">
                    <i className="fas fa-trophy mr-1" />
                    Excellent work!
                  </p>
                )}
                {attempt.score >= 60 && attempt.score < 80 && (
                  <p className="text-yellow-600 mt-2">
                    <i className="fas fa-thumbs-up mr-1" />
                    Good effort! Review the topics below to improve.
                  </p>
                )}
                {attempt.score < 60 && (
                  <p className="text-red-600 mt-2">
                    <i className="fas fa-book mr-1" />
                    Keep practicing! Review the explanations carefully.
                  </p>
                )}
              </div>
            </div>

            {/* Focus Areas */}
            <div>
              <h4 className="font-semibold mb-2">Quiz Focus Areas:</h4>
              <div className="flex flex-wrap gap-2">
                {quiz.focusAreas.map((area, index) => (
                  <Badge key={index} variant="outline" className="bg-blue-50">
                    {area}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Detailed Results */}
            <div className="space-y-4">
              <h4 className="font-semibold">Question Review:</h4>
              {attempt.detailedResults.map((result, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg border-2 ${
                    result.isCorrect
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {result.isCorrect ? (
                        <i className="fas fa-check-circle text-green-600 text-xl" />
                      ) : (
                        <i className="fas fa-times-circle text-red-600 text-xl" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold mb-2">
                        Question {index + 1}: {result.question}
                      </p>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="font-semibold">Your answer:</span>{" "}
                          <span
                            className={result.isCorrect ? "text-green-700" : "text-red-700"}
                          >
                            {result.studentAnswer}
                          </span>
                        </p>
                        {!result.isCorrect && (
                          <p>
                            <span className="font-semibold">Correct answer:</span>{" "}
                            <span className="text-green-700">{result.correctAnswer}</span>
                          </p>
                        )}
                        <div className="mt-2 p-3 bg-white/50 rounded border">
                          <p className="font-semibold text-xs text-gray-600 mb-1">
                            Explanation:
                          </p>
                          <p className="text-gray-700">{result.explanation}</p>
                        </div>
                        <Badge variant="secondary" className="mt-2">
                          {result.topic}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={handleRetake} variant="default">
              <i className="fas fa-redo mr-2" />
              Retake Quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Quiz taking view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <i className="fas fa-clipboard-question text-primary" />
            Improvement Quiz
          </DialogTitle>
          <DialogDescription>
            This quiz focuses on your areas for improvement from the lesson.
            Answer all questions to see your results.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Quiz Info */}
          <div className="p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold">Total Questions:</span>{" "}
                {quiz.questions.length}
              </div>
              <div>
                <span className="font-semibold">Difficulty:</span>{" "}
                <Badge
                  variant={
                    quiz.difficulty === "hard"
                      ? "destructive"
                      : quiz.difficulty === "medium"
                      ? "default"
                      : "secondary"
                  }
                >
                  {quiz.difficulty}
                </Badge>
              </div>
            </div>
            <div className="mt-2">
              <span className="font-semibold text-sm">Focus Areas:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {quiz.focusAreas.map((area, index) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    {area}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Questions */}
          <div className="space-y-6">
            {quiz.questions.map((question: QuizQuestion, index: number) => (
              <div key={index} className="p-4 border rounded-lg bg-white shadow-sm">
                <div className="mb-3">
                  <Badge variant="outline" className="mb-2">
                    {question.topic}
                  </Badge>
                  <h4 className="font-semibold text-base">
                    {index + 1}. {question.question}
                  </h4>
                </div>

                {question.type === "multiple_choice" && question.options ? (
                  <RadioGroup
                    value={answers[index] || ""}
                    onValueChange={(value) =>
                      setAnswers((prev) => ({ ...prev, [index]: value }))
                    }
                  >
                    <div className="space-y-2">
                      {question.options.map((option, optIndex) => (
                        <div key={optIndex} className="flex items-center space-x-2">
                          <RadioGroupItem
                            value={option}
                            id={`q${index}-opt${optIndex}`}
                          />
                          <Label
                            htmlFor={`q${index}-opt${optIndex}`}
                            className="cursor-pointer flex-1 py-2"
                          >
                            {option}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                ) : (
                  <RadioGroup
                    value={answers[index] || ""}
                    onValueChange={(value) =>
                      setAnswers((prev) => ({ ...prev, [index]: value }))
                    }
                  >
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="true" id={`q${index}-true`} />
                        <Label
                          htmlFor={`q${index}-true`}
                          className="cursor-pointer flex-1 py-2"
                        >
                          True
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="false" id={`q${index}-false`} />
                        <Label
                          htmlFor={`q${index}-false`}
                          className="cursor-pointer flex-1 py-2"
                        >
                          False
                        </Label>
                      </div>
                    </div>
                  </RadioGroup>
                )}
              </div>
            ))}
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending || Object.keys(answers).length !== quiz.questions.length}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            {submitMutation.isPending ? (
              <>
                <i className="fas fa-spinner fa-spin mr-2" />
                Submitting...
              </>
            ) : (
              <>
                <i className="fas fa-check mr-2" />
                Submit Answers
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
