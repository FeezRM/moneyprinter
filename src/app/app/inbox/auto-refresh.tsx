"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-fetches the server-rendered inbox so new messages show up without a reload.
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
