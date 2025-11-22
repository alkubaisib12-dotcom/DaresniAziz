import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Card icons - using emojis for simplicity
const CARD_ICONS = [
  "🍎", "🍌", "🍇", "🍊", "🍓", "🍉", "🍒", "🥝", "🍑", "🥭",
  "⚽", "🏀", "🎾", "⚾", "🏐", "🏈", "🎱", "🏓", "🏸", "🥏",
  "📚", "✏️", "📝", "🎨", "🧮", "🔬", "📐", "✂️", "📌", "🖍️"
];

type CardType = {
  id: string;
  icon: string;
  isFlipped: boolean;
  isMatched: boolean;
};

type Difficulty = "easy" | "medium" | "hard";

type GameSettings = {
  difficulty: Difficulty;
  timerMinutes: number | null; // null means no timer
};

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const DIFFICULTY_CONFIG = {
  easy: { pairs: 4, name: "Easy", icon: "😊", description: "8 cards" },
  medium: { pairs: 7, name: "Medium", icon: "🤔", description: "14 cards" },
  hard: { pairs: 10, name: "Hard", icon: "🔥", description: "20 cards" },
};

function StartScreen({
  onStart,
}: {
  onStart: (settings: GameSettings) => void;
}) {
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>("medium");
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);

  return (
    <div className="p-6 space-y-6">
      {/* Title */}
      <div className="text-center space-y-2">
        <div className="text-4xl">🧠</div>
        <h3 className="text-xl font-bold text-foreground">Memory Match</h3>
        <p className="text-sm text-muted-foreground">
          Choose your challenge and start playing!
        </p>
      </div>

      {/* Difficulty Selection */}
      <div className="space-y-3">
        <label className="text-sm font-semibold text-foreground">
          Difficulty Level
        </label>
        <div className="grid gap-3">
          {(Object.keys(DIFFICULTY_CONFIG) as Difficulty[]).map((diff) => {
            const config = DIFFICULTY_CONFIG[diff];
            const isSelected = selectedDifficulty === diff;
            return (
              <button
                key={diff}
                onClick={() => setSelectedDifficulty(diff)}
                className={`
                  p-4 rounded-lg border-2 transition-all text-left
                  ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-md"
                      : "border-muted hover:border-primary/50 bg-muted/30"
                  }
                `}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl">{config.icon}</span>
                    <div>
                      <div className="font-semibold text-foreground">
                        {config.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {config.description}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <i className="fas fa-check-circle text-primary text-xl" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Timer Selection */}
      <div className="space-y-3">
        <label className="text-sm font-semibold text-foreground">
          Timer (Optional)
        </label>
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => setTimerMinutes(null)}
            className={`
              p-3 rounded-lg border-2 transition-all text-center
              ${
                timerMinutes === null
                  ? "border-primary bg-primary/10"
                  : "border-muted bg-muted/30 hover:border-primary/50"
              }
            `}
          >
            <div className="text-xs font-semibold">No Timer</div>
            <div className="text-lg">♾️</div>
          </button>
          {[1, 2, 3].map((minutes) => (
            <button
              key={minutes}
              onClick={() => setTimerMinutes(minutes)}
              className={`
                p-3 rounded-lg border-2 transition-all text-center
                ${
                  timerMinutes === minutes
                    ? "border-primary bg-primary/10"
                    : "border-muted bg-muted/30 hover:border-primary/50"
                }
              `}
            >
              <div className="text-xs font-semibold">{minutes} min</div>
              <div className="text-lg">⏱️</div>
            </button>
          ))}
        </div>
        {timerMinutes !== null && (
          <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center">
            <i className="fas fa-exclamation-triangle mr-1" />
            Complete before timer runs out!
          </p>
        )}
      </div>

      {/* Start Button */}
      <Button
        onClick={() =>
          onStart({ difficulty: selectedDifficulty, timerMinutes })
        }
        className="w-full bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
        size="lg"
      >
        <i className="fas fa-play mr-2" />
        Start Game
      </Button>
    </div>
  );
}

function GameBoard({
  settings,
  onRestart,
}: {
  settings: GameSettings;
  onRestart: () => void;
}) {
  const [cards, setCards] = useState<CardType[]>([]);
  const [flippedCards, setFlippedCards] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [hasWon, setHasWon] = useState(false);
  const [hasLost, setHasLost] = useState(false);

  const pairCount = DIFFICULTY_CONFIG[settings.difficulty].pairs;
  const totalCards = pairCount * 2;
  const timerSeconds = settings.timerMinutes ? settings.timerMinutes * 60 : null;

  // Initialize game
  const initializeGame = () => {
    const selectedIcons = shuffleArray(CARD_ICONS).slice(0, pairCount);
    const cardPairs = [...selectedIcons, ...selectedIcons];
    const shuffledCards = shuffleArray(
      cardPairs.map((icon, index) => ({
        id: `card-${index}`,
        icon,
        isFlipped: false,
        isMatched: false,
      }))
    );
    setCards(shuffledCards);
    setFlippedCards([]);
    setMoves(0);
    setStartTime(Date.now());
    setElapsedTime(0);
    setHasWon(false);
    setHasLost(false);
  };

  useEffect(() => {
    initializeGame();
  }, []);

  // Timer
  useEffect(() => {
    if (!startTime || hasWon || hasLost) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedTime(elapsed);

      // Check if time's up
      if (timerSeconds && elapsed >= timerSeconds) {
        setHasLost(true);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, hasWon, hasLost, timerSeconds]);

  // Check for matches
  useEffect(() => {
    if (flippedCards.length === 2) {
      const [first, second] = flippedCards;
      const firstCard = cards.find((c) => c.id === first);
      const secondCard = cards.find((c) => c.id === second);

      if (firstCard && secondCard && firstCard.icon === secondCard.icon) {
        // Match found
        setTimeout(() => {
          setCards((prev) =>
            prev.map((card) =>
              card.id === first || card.id === second
                ? { ...card, isMatched: true }
                : card
            )
          );
          setFlippedCards([]);
        }, 600);
      } else {
        // No match - flip back after delay
        setTimeout(() => {
          setCards((prev) =>
            prev.map((card) =>
              card.id === first || card.id === second
                ? { ...card, isFlipped: false }
                : card
            )
          );
          setFlippedCards([]);
        }, 1000);
      }
    }
  }, [flippedCards, cards]);

  // Check for win
  useEffect(() => {
    if (cards.length > 0 && cards.every((card) => card.isMatched)) {
      setHasWon(true);
    }
  }, [cards]);

  const handleCardClick = (cardId: string) => {
    if (flippedCards.length >= 2 || hasLost) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.isFlipped || card.isMatched) return;

    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, isFlipped: true } : c))
    );
    setFlippedCards((prev) => [...prev, cardId]);
    if (flippedCards.length === 1) {
      setMoves((m) => m + 1);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getRemainingTime = () => {
    if (!timerSeconds) return null;
    const remaining = Math.max(0, timerSeconds - elapsedTime);
    return remaining;
  };

  const remainingTime = getRemainingTime();
  const isTimerWarning = remainingTime !== null && remainingTime <= 30;

  // Grid columns based on difficulty
  const gridCols =
    settings.difficulty === "easy"
      ? "grid-cols-4"
      : settings.difficulty === "medium"
      ? "grid-cols-4"
      : "grid-cols-5";

  return (
    <>
      {/* Stats */}
      <div className="bg-accent/30 p-3 flex justify-between items-center border-b">
        <div className="flex items-center space-x-3 text-sm">
          <div className="flex items-center space-x-1">
            <i className="fas fa-mouse-pointer text-primary" />
            <span className="font-semibold">{moves}</span>
          </div>
          <div
            className={`flex items-center space-x-1 ${
              isTimerWarning ? "text-red-500 animate-pulse" : ""
            }`}
          >
            <i className="fas fa-clock" />
            <span className="font-semibold">
              {remainingTime !== null
                ? formatTime(remainingTime)
                : formatTime(elapsedTime)}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRestart}
          className="text-xs"
        >
          <i className="fas fa-redo mr-1" />
          Restart
        </Button>
      </div>

      {/* Game Board */}
      <div className="p-4">
        {hasWon ? (
          <div className="text-center py-8 space-y-4">
            <div className="text-6xl">🎉</div>
            <h3 className="text-2xl font-bold text-primary">You Won!</h3>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Difficulty:{" "}
                <span className="font-semibold">
                  {DIFFICULTY_CONFIG[settings.difficulty].name}
                </span>
              </p>
              <p>
                Moves: <span className="font-semibold">{moves}</span>
              </p>
              <p>
                Time: <span className="font-semibold">{formatTime(elapsedTime)}</span>
              </p>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <Button onClick={initializeGame} variant="outline">
                <i className="fas fa-redo mr-2" />
                Same Settings
              </Button>
              <Button onClick={onRestart}>
                <i className="fas fa-cog mr-2" />
                New Game
              </Button>
            </div>
          </div>
        ) : hasLost ? (
          <div className="text-center py-8 space-y-4">
            <div className="text-6xl">⏰</div>
            <h3 className="text-2xl font-bold text-red-500">Time's Up!</h3>
            <p className="text-sm text-muted-foreground">
              You needed a bit more time to complete this challenge.
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Button onClick={initializeGame} variant="outline">
                <i className="fas fa-redo mr-2" />
                Try Again
              </Button>
              <Button onClick={onRestart}>
                <i className="fas fa-cog mr-2" />
                New Game
              </Button>
            </div>
          </div>
        ) : (
          <div className={`grid ${gridCols} gap-2`}>
            {cards.map((card) => (
              <button
                key={card.id}
                onClick={() => handleCardClick(card.id)}
                disabled={card.isMatched || card.isFlipped || hasLost}
                className={`
                  aspect-square rounded-lg border-2 transition-all duration-300
                  flex items-center justify-center font-bold
                  ${
                    settings.difficulty === "hard"
                      ? "text-2xl"
                      : settings.difficulty === "medium"
                      ? "text-3xl"
                      : "text-4xl"
                  }
                  ${
                    card.isFlipped || card.isMatched
                      ? "bg-gradient-to-br from-primary/20 to-primary/10 border-primary"
                      : "bg-gradient-to-br from-muted to-muted/50 border-muted-foreground/20 hover:border-primary/50 hover:scale-105 cursor-pointer"
                  }
                  ${card.isMatched ? "opacity-70" : ""}
                `}
              >
                {card.isFlipped || card.isMatched ? (
                  card.icon
                ) : (
                  <i
                    className={`fas fa-question text-muted-foreground/40 ${
                      settings.difficulty === "hard" ? "text-lg" : "text-2xl"
                    }`}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer Hint */}
      {!hasWon && !hasLost && (
        <div className="bg-accent/20 px-4 py-2 text-xs text-center text-muted-foreground border-t">
          <i className="fas fa-lightbulb mr-1" />
          Match all pairs to win!
          {remainingTime !== null && remainingTime <= 30 && (
            <span className="ml-2 text-red-500 font-semibold">
              Hurry! ⏰
            </span>
          )}
        </div>
      )}
    </>
  );
}

function MemoryGamePanel({ onClose }: { onClose: () => void }) {
  const [gameSettings, setGameSettings] = useState<GameSettings | null>(null);

  const handleStart = (settings: GameSettings) => {
    setGameSettings(settings);
  };

  const handleRestart = () => {
    setGameSettings(null);
  };

  return (
    <div className="fixed bottom-24 right-6 w-[420px] max-h-[85vh] bg-background border-2 border-primary rounded-lg shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-4 duration-300 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white p-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2">
          <i className="fas fa-brain text-xl" />
          <h3 className="font-bold text-lg">Memory Match</h3>
          {gameSettings && (
            <Badge className="bg-white/20 text-white text-xs ml-2">
              {DIFFICULTY_CONFIG[gameSettings.difficulty].name}
            </Badge>
          )}
        </div>
        <button
          onClick={onClose}
          className="hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
        >
          <i className="fas fa-times" />
        </button>
      </div>

      {/* Content - Scrollable */}
      <div className="overflow-y-auto flex-1">
        {gameSettings === null ? (
          <StartScreen onStart={handleStart} />
        ) : (
          <GameBoard settings={gameSettings} onRestart={handleRestart} />
        )}
      </div>
    </div>
  );
}

export default function PreSessionMemoryGame() {
  const [isOpen, setIsOpen] = useState(false);
  const [showBubble, setShowBubble] = useState(true);

  const handleHideBubble = () => {
    setShowBubble(false);
    setIsOpen(false);
  };

  // Listen for menu event to open the game
  useEffect(() => {
    const handleOpenMemoryGame = () => {
      setIsOpen(true);
      setShowBubble(true); // Show the game even if bubble was hidden
    };

    window.addEventListener("open-memory-game", handleOpenMemoryGame);

    return () => {
      window.removeEventListener("open-memory-game", handleOpenMemoryGame);
    };
  }, []);

  if (!showBubble) {
    return null;
  }

  return (
    <>
      {/* Floating Launcher Button */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-50 group">
          <button
            onClick={() => setIsOpen(true)}
            className="w-14 h-14 rounded-full bg-gradient-to-r from-primary to-primary/80 text-white shadow-lg hover:shadow-xl transition-all hover:scale-110 flex items-center justify-center relative"
            title="Play Memory Game"
          >
            <i className="fas fa-brain text-xl" />

            {/* Pulse animation */}
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-20" />
          </button>

          {/* Hide bubble button */}
          <button
            onClick={handleHideBubble}
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 flex items-center justify-center"
            title="Don't show again"
          >
            <i className="fas fa-times text-xs" />
          </button>

          {/* Tooltip */}
          <div className="absolute bottom-full right-0 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap">
              Take a brain break! 🧠
              <div className="absolute top-full right-4 -mt-1">
                <div className="border-4 border-transparent border-t-gray-900" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Game Panel */}
      {isOpen && <MemoryGamePanel onClose={() => setIsOpen(false)} />}
    </>
  );
}
