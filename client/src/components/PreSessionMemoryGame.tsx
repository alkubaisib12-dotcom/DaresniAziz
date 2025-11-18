import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Card icons - using emojis for simplicity
const CARD_ICONS = [
  "🍎", "🍌", "🍇", "🍊", "🍓", "🍉",
  "⚽", "🏀", "🎾", "⚾", "🏐", "🏈",
  "📚", "✏️", "📝", "🎨", "🧮", "🔬"
];

type CardType = {
  id: string;
  icon: string;
  isFlipped: boolean;
  isMatched: boolean;
};

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function MemoryGamePanel({ onClose }: { onClose: () => void }) {
  const [cards, setCards] = useState<CardType[]>([]);
  const [flippedCards, setFlippedCards] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [hasWon, setHasWon] = useState(false);

  // Initialize game
  const initializeGame = () => {
    // Use 6 pairs (12 cards total) for ~5-10 minutes gameplay
    const selectedIcons = shuffleArray(CARD_ICONS).slice(0, 6);
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
  };

  useEffect(() => {
    initializeGame();
  }, []);

  // Timer
  useEffect(() => {
    if (!startTime || hasWon) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, hasWon]);

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
    if (flippedCards.length >= 2) return;
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

  return (
    <div className="fixed bottom-24 right-6 w-[400px] max-h-[600px] bg-background border-2 border-primary rounded-lg shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary to-primary/80 text-white p-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <i className="fas fa-brain text-xl" />
          <h3 className="font-bold text-lg">Memory Match</h3>
        </div>
        <button
          onClick={onClose}
          className="hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
        >
          <i className="fas fa-times" />
        </button>
      </div>

      {/* Stats */}
      <div className="bg-accent/30 p-3 flex justify-between items-center border-b">
        <div className="flex items-center space-x-4 text-sm">
          <div className="flex items-center space-x-1">
            <i className="fas fa-mouse-pointer text-primary" />
            <span className="font-semibold">{moves}</span>
            <span className="text-muted-foreground">moves</span>
          </div>
          <div className="flex items-center space-x-1">
            <i className="fas fa-clock text-primary" />
            <span className="font-semibold">{formatTime(elapsedTime)}</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={initializeGame}
          className="text-xs"
        >
          <i className="fas fa-redo mr-1" />
          Restart
        </Button>
      </div>

      {/* Game Board */}
      <div className="p-4 overflow-y-auto max-h-[440px]">
        {hasWon ? (
          <div className="text-center py-12 space-y-4">
            <div className="text-6xl">🎉</div>
            <h3 className="text-2xl font-bold text-primary">You Won!</h3>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Completed in <span className="font-semibold">{moves}</span> moves
              </p>
              <p>
                Time: <span className="font-semibold">{formatTime(elapsedTime)}</span>
              </p>
            </div>
            <Button onClick={initializeGame} className="mt-4">
              <i className="fas fa-play mr-2" />
              Play Again
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {cards.map((card) => (
              <button
                key={card.id}
                onClick={() => handleCardClick(card.id)}
                disabled={card.isMatched || card.isFlipped}
                className={`
                  aspect-square rounded-lg border-2 transition-all duration-300 text-4xl
                  flex items-center justify-center font-bold
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
                  <i className="fas fa-question text-2xl text-muted-foreground/40" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer Hint */}
      {!hasWon && (
        <div className="bg-accent/20 px-4 py-2 text-xs text-center text-muted-foreground border-t">
          <i className="fas fa-lightbulb mr-1" />
          Match all pairs to win!
        </div>
      )}
    </div>
  );
}

export default function PreSessionMemoryGame() {
  const [isOpen, setIsOpen] = useState(false);
  const [showBubble, setShowBubble] = useState(true);

  // Check session storage on mount
  useEffect(() => {
    const hidden = sessionStorage.getItem("memoryGameBubbleHidden");
    if (hidden === "true") {
      setShowBubble(false);
    }
  }, []);

  const handleHideBubble = () => {
    sessionStorage.setItem("memoryGameBubbleHidden", "true");
    setShowBubble(false);
    setIsOpen(false);
  };

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
