// shared/tutorValidation.ts
/**
 * Tutor Profile Validation Logic
 *
 * Validates tutor profiles for completeness and determines:
 * 1. Critical missing data - blocks public visibility on /tutors page
 * 2. Non-critical missing data - allows visibility but reduces booking chances
 */

export interface TutorValidationResult {
  criticalMissing: string[];
  nonCriticalMissing: string[];
  isPubliclyVisible: boolean; // true if no critical issues
}

/**
 * Validates a tutor profile and returns missing fields categorized by severity
 */
export function validateTutorProfile(tutor: any): TutorValidationResult {
  const criticalMissing: string[] = [];
  const nonCriticalMissing: string[] = [];

  // === NO CRITICAL MISSING DATA - All tutors visible on /tutors page ===
  // All validation criteria are non-critical (yellow warnings only)

  // === NON-CRITICAL MISSING DATA (recommended but not required) ===

  // 1. Price per hour
  if (!tutor.pricePerHour || tutor.pricePerHour === 0) {
    nonCriticalMissing.push("pricePerHour");
  }

  // 2. Subjects array
  if (!tutor.subjects || !Array.isArray(tutor.subjects) || tutor.subjects.length === 0) {
    nonCriticalMissing.push("subjects");
  }

  // 3. Availability schedule - at least one day must be enabled
  const hasAvailability = tutor.availability &&
                         typeof tutor.availability === 'object' &&
                         Object.values(tutor.availability).some(
                           (day: any) => day?.isAvailable === true
                         );
  if (!hasAvailability) {
    nonCriticalMissing.push("availability");
  }

  // 4. Name (check both profile name and user name)
  const hasName = (tutor.name && tutor.name.trim()) ||
                  (tutor.user?.firstName && tutor.user.firstName.trim());
  if (!hasName) {
    nonCriticalMissing.push("name");
  }

  // 5. Bio/description
  if (!tutor.bio || !tutor.bio.trim()) {
    nonCriticalMissing.push("bio");
  }

  // 6. Experience
  if (!tutor.experience || !tutor.experience.trim()) {
    nonCriticalMissing.push("experience");
  }

  // 7. Education
  if (!tutor.education || !tutor.education.trim()) {
    nonCriticalMissing.push("education");
  }

  // 8. Languages
  if (!tutor.languages || !Array.isArray(tutor.languages) || tutor.languages.length === 0) {
    nonCriticalMissing.push("languages");
  }

  // 9. Profile picture (checking both profileImage and user.profileImage)
  const hasProfilePicture = (tutor.profileImage && tutor.profileImage.trim()) ||
                            (tutor.user?.profileImage && tutor.user.profileImage.trim());
  if (!hasProfilePicture) {
    nonCriticalMissing.push("profilePicture");
  }

  return {
    criticalMissing,
    nonCriticalMissing,
    isPubliclyVisible: criticalMissing.length === 0,
  };
}

/**
 * Helper function to get user-friendly field names for display
 */
export function getFieldDisplayName(fieldName: string): string {
  const displayNames: Record<string, string> = {
    pricePerHour: "Price per hour",
    subjects: "Teaching subjects",
    name: "Name",
    availability: "Availability schedule (at least one day must be enabled)",
    bio: "Bio/About me",
    experience: "Experience",
    education: "Education",
    languages: "Languages",
    profilePicture: "Profile picture",
  };
  return displayNames[fieldName] || fieldName;
}
