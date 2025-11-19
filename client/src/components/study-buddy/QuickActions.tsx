/**
 * Quick Actions Menu
 *
 * Provides quick access to common Study Buddy actions
 */

import React from "react";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import {
  FileText,
  Brain,
  Calendar,
  TrendingUp,
  X,
} from "lucide-react";

interface QuickActionsProps {
  onAction: (action: string, params?: any) => void;
  onClose: () => void;
}

export default function QuickActions({ onAction, onClose }: QuickActionsProps) {
  const actions = [
    {
      id: "quiz",
      label: "Generate Quiz",
      description: "Test your knowledge",
      icon: Brain,
      color: "text-blue-500",
    },
    {
      id: "summary",
      label: "Summarize Notes",
      description: "Get key points",
      icon: FileText,
      color: "text-green-500",
    },
    {
      id: "revision",
      label: "Revision Plan",
      description: "Plan your study time",
      icon: Calendar,
      color: "text-purple-500",
    },
    {
      id: "progress",
      label: "View Progress",
      description: "Track your learning",
      icon: TrendingUp,
      color: "text-orange-500",
    },
  ];

  return (
    <div className="absolute top-16 right-4 left-4 z-10 animate-in slide-in-from-top-2">
      <Card className="p-4 shadow-lg border-2">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-sm">Quick Actions</h4>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.id}
                variant="outline"
                className="h-auto flex flex-col items-start p-3 hover:bg-accent transition-colors"
                onClick={() => onAction(action.id)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${action.color}`} />
                  <span className="font-medium text-xs">{action.label}</span>
                </div>
                <p className="text-xs text-muted-foreground text-left">
                  {action.description}
                </p>
              </Button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
