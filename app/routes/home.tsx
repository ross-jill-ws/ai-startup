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
    </main>
  );
}
