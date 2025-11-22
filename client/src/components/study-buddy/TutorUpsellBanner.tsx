/**
 * Tutor Upsell Banner
 *
 * Displays tutor recommendations with appropriate priority styling
 */

import React from "react";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { X, ArrowRight, GraduationCap, Star } from "lucide-react";
import { TutorUpsellSuggestion } from "../../../../shared/studyBuddyTypes";
import { cn } from "../../lib/utils";
import { Link } from "wouter";

interface TutorUpsellBannerProps {
  suggestion: TutorUpsellSuggestion;
  onDismiss: () => void;
}

export default function TutorUpsellBanner({
  suggestion,
  onDismiss,
}: TutorUpsellBannerProps) {
  const priorityStyles = {
    high: "border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800",
    medium: "border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800",
    low: "border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800",
  };

  const priorityIcons = {
    high: "⚠️",
    medium: "💡",
    low: "💬",
  };

  return (
    <div className="border-t p-4 bg-gradient-to-b from-transparent to-gray-50 dark:to-gray-900">
      <Card
        className={cn(
          "p-4 border-2 relative animate-in slide-in-from-bottom-2",
          priorityStyles[suggestion.priority]
        )}
      >
        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          className="absolute top-2 right-2 h-6 w-6"
        >
          <X className="w-4 h-4" />
        </Button>

        {/* Priority indicator */}
        <div className="flex items-start gap-3">
          <div className="text-2xl">{priorityIcons[suggestion.priority]}</div>

          <div className="flex-1">
            {/* Message */}
            <div className="prose prose-sm dark:prose-invert max-w-none mb-3">
              <p className="text-sm font-medium mb-2">
                {suggestion.reason}
              </p>
            </div>

            {/* Recommended Tutors */}
            {suggestion.recommendedTutors && suggestion.recommendedTutors.length > 0 && (
              <div className="space-y-2 mb-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                  Recommended Tutors:
                </p>
                {suggestion.recommendedTutors.map((tutor) => (
                  <div
                    key={tutor.tutorId}
                    className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-2 border"
                  >
                    <div className="flex items-center gap-2">
                      <GraduationCap className="w-4 h-4 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{tutor.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                            {tutor.rating}
                          </span>
                          <span>•</span>
                          <span>${tutor.pricePerHour}/hr</span>
                          <span>•</span>
                          <span className="capitalize">{tutor.availability}</span>
                        </div>
                      </div>
                    </div>
                    <Link href={`/tutors/${tutor.tutorId}`}>
                      <Button size="sm" variant="outline">
                        View
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}

            {/* CTA Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {suggestion.ctaButtons.map((button, index) => (
                <Link
                  key={index}
                  href={button.action === "view_tutors" ? "/tutors" : "#"}
                >
                  <Button
                    size="sm"
                    variant={button.action === "dismiss" ? "outline" : "default"}
                    onClick={button.action === "dismiss" ? onDismiss : undefined}
                    className={cn(
                      button.action === "view_tutors" && "gap-1"
                    )}
                  >
                    {button.label}
                    {button.action === "view_tutors" && (
                      <ArrowRight className="w-3 h-3" />
                    )}
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
