// client/src/components/TutorProfileWarnings.tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { validateTutorProfile, getFieldDisplayName } from "@shared/tutorValidation";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface TutorProfileWarningsProps {
  tutorProfile: any;
}

export function TutorProfileWarnings({ tutorProfile }: TutorProfileWarningsProps) {
  const [, navigate] = useLocation();

  if (!tutorProfile) return null;

  const validation = validateTutorProfile(tutorProfile);

  // No warnings needed if profile is complete
  if (validation.criticalMissing.length === 0 && validation.nonCriticalMissing.length === 0) {
    return null;
  }

  const handleEditProfile = () => {
    navigate("/complete-tutor-profile");
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Critical Missing Data - RED */}
      {validation.criticalMissing.length > 0 && (
        <Alert variant="destructive" className="border-red-500 bg-red-50">
          <AlertCircle className="h-5 w-5" />
          <AlertTitle className="text-lg font-semibold">
            Profile Incomplete - Not Visible to Students
          </AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-3">
              Your profile is <strong>NOT visible</strong> on the public tutors page (
              <a href="/tutors" target="_blank" className="underline">
                /tutors
              </a>
              ) because the following required information is missing:
            </p>
            <ul className="list-disc list-inside space-y-1 mb-3">
              {validation.criticalMissing.map((field) => (
                <li key={field} className="font-medium">
                  {getFieldDisplayName(field)}
                </li>
              ))}
            </ul>
            <Button
              onClick={handleEditProfile}
              variant="default"
              size="sm"
              className="mt-2"
            >
              Complete Profile Now
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Non-Critical Missing Data - YELLOW */}
      {validation.nonCriticalMissing.length > 0 && (
        <Alert className="border-yellow-500 bg-yellow-50">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          <AlertTitle className="text-lg font-semibold text-yellow-800">
            Recommended Profile Improvements
          </AlertTitle>
          <AlertDescription className="mt-2 text-yellow-800">
            <p className="mb-3">
              Completing these fields will <strong>increase your chances</strong> of being booked by students:
            </p>
            <ul className="list-disc list-inside space-y-1 mb-3">
              {validation.nonCriticalMissing.map((field) => (
                <li key={field}>{getFieldDisplayName(field)}</li>
              ))}
            </ul>
            <Button
              onClick={handleEditProfile}
              variant="outline"
              size="sm"
              className="mt-2 border-yellow-600 text-yellow-800 hover:bg-yellow-100"
            >
              Improve Profile
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
