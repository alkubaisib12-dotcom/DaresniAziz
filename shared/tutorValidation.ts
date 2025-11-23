// shared/tutorValidation.ts
/**
 * Tutor Profile Validation Logic
 *
 * Validates tutor profiles for critical missing data that blocks public visibility
 */

export interface TutorValidationResult {
  criticalMissing: string[];
  isPubliclyVisible: boolean; // true if no critical issues
}

/**
 * Validates a tutor profile and returns missing critical fields
 */
export function validateTutorProfile(tutor: any): TutorValidationResult {
  const criticalMissing: string[] = [];

  // === CRITICAL MISSING DATA (blocks public visibility) ===

  // 1. Price per hour must be greater than 0
  // Check EITHER base hourly rate OR per-subject pricing
  const hasBasePrice = (tutor.pricePerHour && tutor.pricePerHour > 0) || (tutor.hourlyRate && tutor.hourlyRate > 0);
  const hasSubjectPricing = tutor.subjectPricing &&
                           typeof tutor.subjectPricing === 'object' &&
                           Object.values(tutor.subjectPricing).some((price: any) => price > 0);

  if (!hasBasePrice && !hasSubjectPricing) {
    criticalMissing.push("pricePerHour");
  }

  return {
    criticalMissing,
    isPubliclyVisible: criticalMissing.length === 0,
  };
}

/**
 * Helper function to get user-friendly field names for display
 */
export function getFieldDisplayName(fieldName: string): string {
  const displayNames: Record<string, string> = {
    pricePerHour: "Hourly Rate / Price",
  };
  return displayNames[fieldName] || fieldName;
}
