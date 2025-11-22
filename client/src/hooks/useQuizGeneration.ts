/**
 * useQuizGeneration Hook
 *
 * Hook for generating and taking quizzes
 */

import { useState, useCallback } from "react";
import {
  QuizGenerationRequest,
  QuizGenerationResponse,
  QuizSubmissionRequest,
  QuizSubmissionResponse,
  QuizQuestion,
} from "../../../shared/studyBuddyTypes";

interface UseQuizGenerationReturn {
  quiz: QuizGenerationResponse | null;
  isGenerating: boolean;
  isSubmitting: boolean;
  error: string | null;
  results: QuizSubmissionResponse | null;
  generateQuiz: (request: QuizGenerationRequest) => Promise<void>;
  submitQuiz: (quizId: string, answers: QuizSubmissionRequest) => Promise<void>;
  resetQuiz: () => void;
}

export function useQuizGeneration(): UseQuizGenerationReturn {
  const [quiz, setQuiz] = useState<QuizGenerationResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<QuizSubmissionResponse | null>(null);

  /**
   * Generate a new quiz
   */
  const generateQuiz = useCallback(async (request: QuizGenerationRequest) => {
    setIsGenerating(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch("/api/study-buddy/quiz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate quiz");
      }

      const data: QuizGenerationResponse = await response.json();
      setQuiz(data);
    } catch (err: any) {
      console.error("Error generating quiz:", err);
      setError(err.message || "Failed to generate quiz");
    } finally {
      setIsGenerating(false);
    }
  }, []);

  /**
   * Submit quiz answers
   */
  const submitQuiz = useCallback(
    async (quizId: string, submission: QuizSubmissionRequest) => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch(`/api/study-buddy/quiz/${quizId}/submit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(submission),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to submit quiz");
        }

        const data: QuizSubmissionResponse = await response.json();
        setResults(data);
      } catch (err: any) {
        console.error("Error submitting quiz:", err);
        setError(err.message || "Failed to submit quiz");
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  /**
   * Reset quiz state
   */
  const resetQuiz = useCallback(() => {
    setQuiz(null);
    setResults(null);
    setError(null);
  }, []);

  return {
    quiz,
    isGenerating,
    isSubmitting,
    error,
    results,
    generateQuiz,
    submitQuiz,
    resetQuiz,
  };
}
