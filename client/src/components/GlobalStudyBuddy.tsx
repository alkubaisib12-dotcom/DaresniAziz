// client/src/components/GlobalStudyBuddy.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import StudyBuddyPanel from "@/components/study-buddy/StudyBuddyPanel";

/**
 * Global Study Buddy component that appears on all pages for students
 * Renders a floating action button and the Study Buddy panel
 */
export default function GlobalStudyBuddy() {
  const { user } = useAuth();
  const [showStudyBuddy, setShowStudyBuddy] = useState(false);

  // Only show for students
  if (!user || user.role !== "student") {
    return null;
  }

  return (
    <>
      {/* Floating Action Button for AI Study Buddy */}
      {!showStudyBuddy && (
        <Button
          onClick={() => setShowStudyBuddy(true)}
          className="fixed bottom-4 left-4 h-14 w-14 rounded-full shadow-lg bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 z-40"
          size="icon"
          title="AI Study Buddy"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      )}

      {/* AI Study Buddy Panel */}
      <StudyBuddyPanel
        isOpen={showStudyBuddy}
        onClose={() => setShowStudyBuddy(false)}
      />
    </>
  );
}
