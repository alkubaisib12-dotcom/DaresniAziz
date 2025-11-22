import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import {
  getSubjects,
  getTutorProfiles,
  getUserSessions,
  createTutorProfile,
  updateTutorProfile,
  createSession,
  updateSession,
  getTutorReviews,
  createReview,
  getConversationMessages,
  createMessage
} from "@/lib/firestore";
import type {
  Subject,
  TutorProfile,
  Session,
  Review,
  Message,
  CreateTutorProfile,
  UpdateTutorProfile,
  CreateSession,
  UpdateSession,
  CreateReview,
  CreateMessage
} from "@shared/types";

// Subjects
export const useSubjects = () => {
  return useQuery<Subject[]>({
    queryKey: ["subjects"],
    queryFn: getSubjects,
  });
};

// Tutor Profiles
export const useTutorProfiles = () => {
  return useQuery<TutorProfile[]>({
    queryKey: ["tutorProfiles"],
    queryFn: getTutorProfiles,
  });
};

export const useCreateTutorProfile = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createTutorProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tutorProfiles"] });
    },
  });
};

export const useUpdateTutorProfile = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ userId, updates }: { userId: string; updates: UpdateTutorProfile }) =>
      updateTutorProfile(userId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tutorProfiles"] });
    },
  });
};

// Sessions
export const useUserSessions = (role: 'student' | 'tutor') => {
  const { user } = useAuth();
  
  return useQuery<Session[]>({
    queryKey: ["sessions", user?.id, role],
    queryFn: () => getUserSessions(user!.id, role),
    enabled: !!user,
  });
};

export const useCreateSession = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

export const useUpdateSession = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ sessionId, updates }: { sessionId: string; updates: UpdateSession }) =>
      updateSession(sessionId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
};

// Reviews
export const useTutorReviews = (tutorId: string) => {
  return useQuery<Review[]>({
    queryKey: ["reviews", tutorId],
    queryFn: () => getTutorReviews(tutorId),
    enabled: !!tutorId,
  });
};

export const useCreateReview = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createReview,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["reviews", variables.tutorId] });
      queryClient.invalidateQueries({ queryKey: ["tutorProfiles"] });
    },
  });
};

// Messages
export const useConversationMessages = (userId1: string, userId2: string) => {
  return useQuery<Message[]>({
    queryKey: ["messages", userId1, userId2],
    queryFn: () => getConversationMessages(userId1, userId2),
    enabled: !!userId1 && !!userId2,
    refetchInterval: 15000, // Optimized: 15s instead of 5s for messages
    staleTime: 10000, // Cache for 10s
  });
};

export const useCreateMessage = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createMessage,
    onSuccess: (_, variables) => {
      // Invalidate conversation queries for both users
      queryClient.invalidateQueries({ 
        queryKey: ["messages", variables.senderId, variables.receiverId] 
      });
      queryClient.invalidateQueries({ 
        queryKey: ["messages", variables.receiverId, variables.senderId] 
      });
    },
  });
};
