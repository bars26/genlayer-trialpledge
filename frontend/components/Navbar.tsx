"use client";

import { Plus } from "lucide-react";
import { AccountPanel } from "./AccountPanel";
import { BrandMark } from "./BrandMark";
import { FaucetButton } from "./FaucetButton";
import { Button } from "./ui/button";

export function Navbar({ onPledge }: { onPledge: () => void }) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-white/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <a href="/" className="flex items-center gap-2.5">
          <BrandMark size={32} />
          <span className="display text-xl font-semibold tracking-tight">TrialPledge</span>
        </a>
        <div className="flex items-center gap-2 sm:gap-3">
          <FaucetButton />
          <Button size="sm" onClick={onPledge}>
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Back a trial</span>
          </Button>
          <AccountPanel />
        </div>
      </div>
    </header>
  );
}
