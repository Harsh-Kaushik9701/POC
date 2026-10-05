"use client";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en-AU">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, background: "#f2f1ee", color: "#17171a" }}>
        <h1>Akaal Management couldn&apos;t start</h1>
        <p>Open <a href="/status">/status</a> to see what&apos;s missing (usually the database settings).</p>
        {error.digest && <p style={{ color: "#5d5c63", fontSize: 13 }}>Error reference: {error.digest}</p>}
      </body>
    </html>
  );
}
