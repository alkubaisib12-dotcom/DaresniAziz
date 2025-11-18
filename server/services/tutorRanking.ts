/**
 * AI-Powered Tutor Matching Service
 *
 * Intelligently ranks tutors based on multiple criteria:
 * - Subject expertise and match
 * - Rating and reviews
 * - Success metrics (completion rate, repeat students)
 * - Availability
 * - Value for money
 * - Experience level
 */

import { Firestore } from "firebase-admin/firestore";

export interface TutorRankingCriteria {
  subjectId?: string;
  gradeLevel?: string;
  studentId?: string;
  maxBudget?: number;  // in cents
  preferredDays?: string[];  // ["monday", "wednesday"]
  preferredTimeSlots?: string[];  // ["10:00", "14:00"]
}

export interface RankedTutor {
  tutorId: string;
  score: number;  // 0-100
  breakdown: {
    subjectExpertise: number;  // 0-25
    ratingScore: number;       // 0-20
    successMetrics: number;    // 0-20
    availability: number;      // 0-15
    valueScore: number;        // 0-10
    experience: number;        // 0-10
  };
  reasoning: string[];  // Human-readable explanations
}

export class TutorRankingService {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  /**
   * Main ranking function - returns sorted list of tutors by AI score
   */
  async rankTutors(
    tutorIds: string[],
    criteria: TutorRankingCriteria
  ): Promise<RankedTutor[]> {
    if (tutorIds.length === 0) {
      return [];
    }

    const rankings: RankedTutor[] = [];

    for (const tutorId of tutorIds) {
      try {
        const ranking = await this.scoreTutor(tutorId, criteria);
        rankings.push(ranking);
      } catch (error) {
        console.error(`Error ranking tutor ${tutorId}:`, error);
        // Continue with other tutors
      }
    }

    // Sort by score descending
    return rankings.sort((a, b) => b.score - a.score);
  }

  /**
   * Score a single tutor based on all criteria
   */
  private async scoreTutor(
    tutorId: string,
    criteria: TutorRankingCriteria
  ): Promise<RankedTutor> {
    const [
      subjectScore,
      ratingScore,
      successScore,
      availabilityScore,
      valueScore,
      experienceScore,
    ] = await Promise.all([
      this.scoreSubjectExpertise(tutorId, criteria),
      this.scoreRating(tutorId),
      this.scoreSuccessMetrics(tutorId, criteria),
      this.scoreAvailability(tutorId, criteria),
      this.scoreValue(tutorId, criteria),
      this.scoreExperience(tutorId),
    ]);

    const breakdown = {
      subjectExpertise: subjectScore.score,
      ratingScore: ratingScore.score,
      successMetrics: successScore.score,
      availability: availabilityScore.score,
      valueScore: valueScore.score,
      experience: experienceScore.score,
    };

    const totalScore =
      breakdown.subjectExpertise +
      breakdown.ratingScore +
      breakdown.successMetrics +
      breakdown.availability +
      breakdown.valueScore +
      breakdown.experience;

    const reasoning = [
      ...subjectScore.reasons,
      ...ratingScore.reasons,
      ...successScore.reasons,
      ...availabilityScore.reasons,
      ...valueScore.reasons,
      ...experienceScore.reasons,
    ];

    return {
      tutorId,
      score: Math.round(totalScore * 10) / 10,  // Round to 1 decimal
      breakdown,
      reasoning,
    };
  }

  /**
   * Score subject expertise (0-25 points)
   * - Does tutor teach this subject?
   * - Number of sessions in this subject
   * - Subject-specific rating
   */
  private async scoreSubjectExpertise(
    tutorId: string,
    criteria: TutorRankingCriteria
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];
    let score = 0;

    if (!criteria.subjectId) {
      return { score: 25, reasons: ["No subject filter - full points"] };
    }

    // Check if tutor teaches this subject
    const tutorSubjectSnap = await this.db
      .collection("tutor_subjects")
      .where("tutorId", "==", tutorId)
      .where("subjectId", "==", criteria.subjectId)
      .limit(1)
      .get();

    if (tutorSubjectSnap.empty) {
      return { score: 0, reasons: ["Does not teach requested subject"] };
    }

    score += 10;
    reasons.push("Teaches requested subject");

    // Count sessions in this subject
    const sessionsSnap = await this.db
      .collection("tutoring_sessions")
      .where("tutorId", "==", tutorId)
      .where("subjectId", "==", criteria.subjectId)
      .where("status", "==", "completed")
      .get();

    const sessionCount = sessionsSnap.size;

    if (sessionCount > 50) {
      score += 10;
      reasons.push(`Highly experienced in subject (${sessionCount}+ sessions)`);
    } else if (sessionCount > 20) {
      score += 7;
      reasons.push(`Experienced in subject (${sessionCount} sessions)`);
    } else if (sessionCount > 5) {
      score += 5;
      reasons.push(`Some experience in subject (${sessionCount} sessions)`);
    } else {
      score += 2;
      reasons.push(`Limited experience in subject (${sessionCount} sessions)`);
    }

    // Calculate subject-specific rating
    const reviewsSnap = await this.db
      .collection("reviews")
      .where("tutorId", "==", tutorId)
      .get();

    const subjectReviews = reviewsSnap.docs.filter((doc) => {
      const sessionId = doc.data().sessionId;
      return sessionsSnap.docs.some((s) => s.id === sessionId);
    });

    if (subjectReviews.length > 0) {
      const avgRating =
        subjectReviews.reduce((sum, r) => sum + (r.data().rating || 0), 0) /
        subjectReviews.length;

      if (avgRating >= 4.5) {
        score += 5;
        reasons.push(`Excellent subject-specific rating (${avgRating.toFixed(1)}/5)`);
      } else if (avgRating >= 4.0) {
        score += 4;
        reasons.push(`Good subject-specific rating (${avgRating.toFixed(1)}/5)`);
      } else if (avgRating >= 3.5) {
        score += 2;
        reasons.push(`Average subject-specific rating (${avgRating.toFixed(1)}/5)`);
      }
    }

    return { score, reasons };
  }

  /**
   * Score overall rating (0-20 points)
   * - Average rating weighted by number of reviews
   */
  private async scoreRating(
    tutorId: string
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];
    let score = 0;

    const reviewsSnap = await this.db
      .collection("reviews")
      .where("tutorId", "==", tutorId)
      .get();

    if (reviewsSnap.empty) {
      return { score: 0, reasons: ["No reviews yet"] };
    }

    const reviews = reviewsSnap.docs.map((d) => d.data());
    const avgRating =
      reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
    const reviewCount = reviews.length;

    // Base score from rating (0-15 points)
    if (avgRating >= 4.8) {
      score += 15;
      reasons.push(`Exceptional rating (${avgRating.toFixed(2)}/5)`);
    } else if (avgRating >= 4.5) {
      score += 13;
      reasons.push(`Excellent rating (${avgRating.toFixed(2)}/5)`);
    } else if (avgRating >= 4.0) {
      score += 10;
      reasons.push(`Good rating (${avgRating.toFixed(2)}/5)`);
    } else if (avgRating >= 3.5) {
      score += 6;
      reasons.push(`Average rating (${avgRating.toFixed(2)}/5)`);
    } else {
      score += 3;
      reasons.push(`Below average rating (${avgRating.toFixed(2)}/5)`);
    }

    // Confidence bonus from review count (0-5 points)
    if (reviewCount >= 50) {
      score += 5;
      reasons.push(`High confidence (${reviewCount} reviews)`);
    } else if (reviewCount >= 20) {
      score += 4;
      reasons.push(`Good confidence (${reviewCount} reviews)`);
    } else if (reviewCount >= 10) {
      score += 3;
      reasons.push(`Moderate confidence (${reviewCount} reviews)`);
    } else if (reviewCount >= 5) {
      score += 2;
      reasons.push(`Some reviews (${reviewCount})`);
    } else {
      score += 1;
      reasons.push(`Few reviews (${reviewCount})`);
    }

    return { score, reasons };
  }

  /**
   * Score success metrics (0-20 points)
   * - Session completion rate
   * - Repeat student rate
   */
  private async scoreSuccessMetrics(
    tutorId: string,
    criteria: TutorRankingCriteria
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];
    let score = 0;

    // Get all sessions for this tutor
    const allSessionsSnap = await this.db
      .collection("tutoring_sessions")
      .where("tutorId", "==", tutorId)
      .get();

    if (allSessionsSnap.empty) {
      return { score: 0, reasons: ["No session history"] };
    }

    const sessions = allSessionsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    // Calculate completion rate (0-12 points)
    const nonCancelled = sessions.filter((s) => s.status !== "cancelled");
    const completed = sessions.filter((s) => s.status === "completed");

    if (nonCancelled.length > 0) {
      const completionRate = completed.length / nonCancelled.length;

      if (completionRate >= 0.95) {
        score += 12;
        reasons.push(
          `Excellent completion rate (${(completionRate * 100).toFixed(0)}%)`
        );
      } else if (completionRate >= 0.85) {
        score += 9;
        reasons.push(
          `Good completion rate (${(completionRate * 100).toFixed(0)}%)`
        );
      } else if (completionRate >= 0.75) {
        score += 6;
        reasons.push(
          `Average completion rate (${(completionRate * 100).toFixed(0)}%)`
        );
      } else {
        score += 3;
        reasons.push(
          `Below average completion rate (${(completionRate * 100).toFixed(0)}%)`
        );
      }
    }

    // Calculate repeat student rate (0-8 points)
    const studentIds = sessions.map((s) => s.studentId);
    const uniqueStudents = new Set(studentIds).size;
    const repeatRate = uniqueStudents > 0 ? studentIds.length / uniqueStudents : 0;

    if (repeatRate >= 3.0) {
      score += 8;
      reasons.push(
        `Excellent student retention (${repeatRate.toFixed(1)}x avg sessions/student)`
      );
    } else if (repeatRate >= 2.0) {
      score += 6;
      reasons.push(
        `Good student retention (${repeatRate.toFixed(1)}x avg sessions/student)`
      );
    } else if (repeatRate >= 1.5) {
      score += 4;
      reasons.push(
        `Some repeat students (${repeatRate.toFixed(1)}x avg sessions/student)`
      );
    } else {
      score += 2;
      reasons.push(
        `Few repeat students (${repeatRate.toFixed(1)}x avg sessions/student)`
      );
    }

    return { score, reasons };
  }

  /**
   * Score availability (0-15 points)
   * - Has available time slots
   * - Matches preferred days/times
   */
  private async scoreAvailability(
    tutorId: string,
    criteria: TutorRankingCriteria
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];
    let score = 0;

    const tutorProfileSnap = await this.db
      .collection("tutor_profiles")
      .where("userId", "==", tutorId)
      .limit(1)
      .get();

    if (tutorProfileSnap.empty) {
      return { score: 0, reasons: ["No availability data"] };
    }

    const tutorProfile = tutorProfileSnap.docs[0].data();
    const availability = tutorProfile.availability || {};

    // Count available days
    const availableDays = Object.entries(availability).filter(
      ([_, slot]: [string, any]) => slot.isAvailable === true
    );

    // Base score for having availability (0-8 points)
    if (availableDays.length >= 6) {
      score += 8;
      reasons.push("Very flexible schedule (6+ days available)");
    } else if (availableDays.length >= 4) {
      score += 6;
      reasons.push(`Flexible schedule (${availableDays.length} days available)`);
    } else if (availableDays.length >= 2) {
      score += 4;
      reasons.push(`Limited availability (${availableDays.length} days available)`);
    } else if (availableDays.length === 1) {
      score += 2;
      reasons.push("Very limited availability (1 day)");
    }

    // Bonus for matching preferred days (0-7 points)
    if (criteria.preferredDays && criteria.preferredDays.length > 0) {
      const matchingDays = availableDays.filter(([day]) =>
        criteria.preferredDays!.includes(day.toLowerCase())
      );

      if (matchingDays.length === criteria.preferredDays.length) {
        score += 7;
        reasons.push("Available on all your preferred days");
      } else if (matchingDays.length > 0) {
        score += 4;
        reasons.push(
          `Available on ${matchingDays.length}/${criteria.preferredDays.length} preferred days`
        );
      }
    } else {
      // No preference specified - give medium bonus
      score += 3;
    }

    return { score, reasons };
  }

  /**
   * Score value for money (0-10 points)
   * - Rating vs. price ratio
   * - Within budget
   */
  private async scoreValue(
    tutorId: string,
    criteria: TutorRankingCriteria
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];
    let score = 0;

    const tutorProfileSnap = await this.db
      .collection("tutor_profiles")
      .where("userId", "==", tutorId)
      .limit(1)
      .get();

    if (tutorProfileSnap.empty) {
      return { score: 5, reasons: ["No pricing data"] };
    }

    const tutorProfile = tutorProfileSnap.docs[0].data();

    // Get pricing (check subject-specific or fallback to general)
    let hourlyRateCents = 0;
    if (criteria.subjectId && tutorProfile.subjectPricing) {
      hourlyRateCents = tutorProfile.subjectPricing[criteria.subjectId] || 0;
    }
    if (!hourlyRateCents && tutorProfile.hourlyRate) {
      hourlyRateCents = tutorProfile.hourlyRate * 100;
    }

    if (hourlyRateCents === 0) {
      return { score: 5, reasons: ["No pricing set"] };
    }

    // Check if within budget
    if (criteria.maxBudget && hourlyRateCents > criteria.maxBudget) {
      return { score: 0, reasons: ["Outside your budget"] };
    }

    score += 5;
    reasons.push("Within your budget");

    // Get rating for value calculation
    const reviewsSnap = await this.db
      .collection("reviews")
      .where("tutorId", "==", tutorId)
      .get();

    if (reviewsSnap.size > 0) {
      const avgRating =
        reviewsSnap.docs.reduce((sum, d) => sum + (d.data().rating || 0), 0) /
        reviewsSnap.size;

      // Value score = rating / (price in dollars / 10)
      // Higher rating + lower price = better value
      const hourlyRateDollars = hourlyRateCents / 100;
      const valueRatio = avgRating / (hourlyRateDollars / 10);

      if (valueRatio >= 8) {
        score += 5;
        reasons.push("Excellent value for money");
      } else if (valueRatio >= 5) {
        score += 4;
        reasons.push("Good value for money");
      } else if (valueRatio >= 3) {
        score += 3;
        reasons.push("Fair value");
      } else {
        score += 2;
        reasons.push("Premium pricing");
      }
    } else {
      score += 3;
    }

    return { score, reasons };
  }

  /**
   * Score experience level (0-10 points)
   * - Total sessions taught
   * - Certifications
   */
  private async scoreExperience(
    tutorId: string
  ): Promise<{ score: number; reasons: string[] }> {
    const reasons: string[] = [];
    let score = 0;

    // Count total sessions
    const sessionsSnap = await this.db
      .collection("tutoring_sessions")
      .where("tutorId", "==", tutorId)
      .where("status", "==", "completed")
      .get();

    const totalSessions = sessionsSnap.size;

    if (totalSessions >= 100) {
      score += 6;
      reasons.push(`Highly experienced (${totalSessions}+ sessions)`);
    } else if (totalSessions >= 50) {
      score += 5;
      reasons.push(`Very experienced (${totalSessions} sessions)`);
    } else if (totalSessions >= 20) {
      score += 4;
      reasons.push(`Experienced (${totalSessions} sessions)`);
    } else if (totalSessions >= 10) {
      score += 3;
      reasons.push(`Some experience (${totalSessions} sessions)`);
    } else if (totalSessions >= 5) {
      score += 2;
      reasons.push(`New tutor (${totalSessions} sessions)`);
    } else {
      score += 1;
      reasons.push(`Very new tutor (${totalSessions} sessions)`);
    }

    // Check for certifications
    const tutorProfileSnap = await this.db
      .collection("tutor_profiles")
      .where("userId", "==", tutorId)
      .limit(1)
      .get();

    if (!tutorProfileSnap.empty) {
      const tutorProfile = tutorProfileSnap.docs[0].data();
      const certifications = tutorProfile.certifications || [];

      if (certifications.length >= 3) {
        score += 4;
        reasons.push(`Multiple certifications (${certifications.length})`);
      } else if (certifications.length >= 1) {
        score += 2;
        reasons.push(`Certified (${certifications.length} certification${certifications.length > 1 ? 's' : ''})`);
      }
    }

    return { score, reasons };
  }
}
