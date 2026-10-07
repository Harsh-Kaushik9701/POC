"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the current server page every `seconds` so live numbers stay current. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => { const i = setInterval(() => router.refresh(), seconds * 1000); return () => clearInterval(i); }, [router, seconds]);
  return null;
}
