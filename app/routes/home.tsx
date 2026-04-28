import { Link } from "react-router";

import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "React Router v7 + Cloudflare Workers" },
    { name: "description", content: "Welcome to React Router v7 on Cloudflare Workers!" },
  ];
}

export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 2rem" }}>
      <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>
        React Router v7
      </h1>
      <p style={{ fontSize: "1.25rem", color: "#666" }}>
        Running on Cloudflare Workers
      </p>
      <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap", marginTop: "2rem" }}>
        <Link to="/counter" style={{ fontSize: "1rem", color: "#f6821f" }}>
          → Try the Counter Agent demo
        </Link>
        <Link to="/chat-agent" style={{ fontSize: "1rem", color: "#a855f7" }}>
          → Chat with the LLM-backed Agent
        </Link>
        <Link to="/test-ai-worker" style={{ fontSize: "1rem", color: "#0ea5e9" }}>
          → Open the streaming AI chat demo
        </Link>
      </div>
    </main>
  );
}
