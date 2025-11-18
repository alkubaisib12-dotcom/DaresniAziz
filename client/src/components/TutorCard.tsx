import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatMoney } from "@/lib/currency";
import { useAuth } from "@/hooks/useAuth";

type TutorCardProps = {
  tutor: any; // expects { id, user, hourlyRate, subjects, averageRating?, reviewCount?, totalRating?, totalReviews?, isVerified?, isActive?, bio?, experience? }
  onBook: () => void;
  onViewProfile: () => void;
  onFavorite: () => void;
  isFavorite?: boolean;
};

export function TutorCard({
  tutor,
  onBook,
  onViewProfile,
  onFavorite,
  isFavorite = false,
}: TutorCardProps) {
  const { user } = useAuth();
  const hourlyRate = Number(tutor?.hourlyRate ?? 0);

  // AI matching data
  const aiScore = tutor?.aiScore;
  const aiReasoning = tutor?.aiReasoning ?? [];
  const hasAIMatch = aiScore !== undefined && aiScore > 0;

  // Be flexible with backend field names
  const rawAverageRating =
    tutor?.averageRating ??
    tutor?.avgRating ??
    tutor?.rating ??
    tutor?.totalRating ??
    0;

  const rawTotalReviews =
    tutor?.reviewCount ??
    tutor?.reviewsCount ??
    tutor?.totalReviews ??
    tutor?.ratingCount ??
    0;

  const averageRating = Number(rawAverageRating) || 0;
  const totalReviews = Number(rawTotalReviews) || 0;

  const isActive = Boolean(tutor?.isActive ?? true);
  const isVerified = Boolean(tutor?.isVerified ?? false);

  // Normalize subjects: support strings or {id,name}
  const subjects: { id: string; name: string }[] = (tutor?.subjects ?? []).map(
    (s: any, idx: number) =>
      typeof s === "string"
        ? { id: s, name: s }
        : { id: s?.id ?? String(idx), name: s?.name ?? String(s) }
  );

  const subjectsLine =
    subjects.length > 0 ? subjects.map((s) => s.name).join(", ") : "General Tutoring";

  const firstName = tutor?.user?.firstName ?? "Tutor";
  const lastName = tutor?.user?.lastName ?? "";
  const profileImageUrl = tutor?.user?.profileImageUrl ?? "";

  const hasReviews = totalReviews > 0 && averageRating > 0;

  return (
    <Card
      className={`card-hover h-full ${hasAIMatch ? 'border-2 border-primary shadow-lg' : ''}`}
      data-testid={`tutor-card-${tutor?.id ?? "unknown"}`}
    >
      <CardContent className="p-6 h-full flex flex-col">
        {/* AI Match Badge */}
        {hasAIMatch && (
          <div className="mb-3 flex items-center justify-between">
            <Badge className="bg-gradient-to-r from-purple-500 to-pink-500 text-white">
              <i className="fas fa-star mr-1" />
              AI Match: {aiScore?.toFixed(0)}% Perfect
            </Badge>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start space-x-4 mb-4">
          <Avatar className="w-16 h-16">
            <AvatarImage src={profileImageUrl} alt={firstName} />
            <AvatarFallback>
              {firstName?.[0] ?? "T"}
              {lastName?.[0] ?? ""}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <h3
              className="font-semibold text-lg text-foreground truncate"
              data-testid="text-tutor-name"
            >
              {firstName} {lastName}
            </h3>
            <p className="text-muted-foreground text-sm truncate">{subjectsLine}</p>

            {/* Rating */}
            <div className="flex items-center mt-2">
              <div className="flex text-yellow-400">
                {[...Array(5)].map((_, i) => (
                  <i
                    key={i}
                    className={`fas fa-star text-sm ${
                      i < Math.round(averageRating) ? "" : "text-gray-300"
                    }`}
                  />
                ))}
              </div>
              <span
                className="text-sm text-muted-foreground ml-2"
                data-testid="text-rating"
              >
                {hasReviews
                  ? `${averageRating.toFixed(1)} (${totalReviews} review${
                      totalReviews === 1 ? "" : "s"
                    })`
                  : "No reviews yet"}
              </span>
            </div>
          </div>

          {/* Price and Status */}
          <div className="text-right">
            <div className="text-lg font-bold text-primary" data-testid="text-hourly-rate">
  {formatMoney(hourlyRate)}/hr
</div>

            <div className="flex items-center justify-end mt-1">
              <div
                className={`w-3 h-3 rounded-full ${
                  isActive ? "bg-green-500" : "bg-yellow-400"
                }`}
              />
              <span className="text-xs text-muted-foreground ml-1">
                {isActive ? "Available" : "Busy"}
              </span>
            </div>
          </div>
        </div>

        {/* Bio */}
        <p className="text-muted-foreground text-sm mb-4 line-clamp-3 flex-1">
          {tutor?.bio ?? ""}
        </p>

        {/* Subjects/Expertise Tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          {subjects.slice(0, 3).map((subject) => (
            <Badge
              key={subject.id}
              variant="secondary"
              className="bg-primary/10 text-primary text-xs"
            >
              {subject.name}
            </Badge>
          ))}
          {subjects.length > 3 && (
            <Badge variant="outline" className="text-xs">
              +{subjects.length - 3} more
            </Badge>
          )}
        </div>

        {/* Verification Badge */}
        {isVerified && (
          <div className="flex items-center justify-center mb-4">
            <Badge variant="secondary" className="bg-green-100 text-green-800">
              <i className="fas fa-check-circle mr-1" />
              Verified Tutor
            </Badge>
          </div>
        )}

        {/* AI Match Reasoning */}
        {hasAIMatch && aiReasoning.length > 0 && (
          <div className="mb-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
            <div className="text-xs font-semibold text-primary mb-2 flex items-center">
              <i className="fas fa-lightbulb mr-2" />
              Why this tutor is a great match:
            </div>
            <ul className="space-y-1">
              {aiReasoning.slice(0, 3).map((reason, idx) => (
                <li key={idx} className="text-xs text-muted-foreground flex items-start">
                  <i className="fas fa-check-circle text-primary mr-2 mt-0.5 text-[10px]" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
            {aiReasoning.length > 3 && (
              <p className="text-xs text-muted-foreground mt-2 italic">
                +{aiReasoning.length - 3} more reasons...
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-2 mt-auto">
          {user?.role !== "tutor" && (
            <Button
              className="btn-primary flex-1"
              onClick={onBook}
              disabled={!isVerified || !isActive}
              data-testid="button-book-session"
            >
              <i className="fas fa-calendar-plus mr-2" />
              Book Session
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={onViewProfile}
            data-testid="button-view-profile"
          >
            <i className="fas fa-user" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onFavorite}
            data-testid="button-favorite"
            className={
              isFavorite
                ? "text-red-500 border-red-500 hover:text-red-600 hover:border-red-600"
                : ""
            }
          >
            <i className={isFavorite ? "fas fa-heart" : "far fa-heart"} />
          </Button>
        </div>

        {/* Experience Highlight */}
        {tutor?.experience && (
          <div className="mt-3 p-2 bg-accent/30 rounded-lg">
            <div className="flex items-center space-x-2">
              <i className="fas fa-medal text-primary text-sm" />
              <span className="text-sm text-muted-foreground truncate">
                {String(tutor.experience).slice(0, 60)}...
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
