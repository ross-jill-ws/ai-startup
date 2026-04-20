import { useState } from "react";
import { useAgent } from "agents/react";
import type { CounterAgent, CounterState } from "../../workers/agent";

export function meta() {
  return [{ title: "Counter Agent" }];
}

export default function Counter() {
  const [count, setCount] = useState(0);

  const agent = useAgent<CounterAgent, CounterState>({
    agent: "CounterAgent",
    onStateUpdate: (state) => setCount(state.count),
  });

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 2rem" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Counter Agent</h1>
      <p style={{ color: "#666", marginBottom: "2rem", fontSize: "0.9rem" }}>
        State lives in a Cloudflare Durable Object — synced in real time via WebSocket
      </p>
      <p style={{ fontSize: "5rem", margin: "1rem 0", fontWeight: "bold" }}>{count}</p>
      <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
        <button
          onClick={() => agent.stub.decrement()}
          style={{ padding: "0.5rem 1.5rem", fontSize: "1.5rem", borderRadius: 8, cursor: "pointer" }}
        >
          −
        </button>
        <button
          onClick={() => agent.stub.reset()}
          style={{ padding: "0.5rem 1.5rem", fontSize: "1rem", borderRadius: 8, cursor: "pointer" }}
        >
          Reset
        </button>
        <button
          onClick={() => agent.stub.increment()}
          style={{ padding: "0.5rem 1.5rem", fontSize: "1.5rem", borderRadius: 8, cursor: "pointer" }}
        >
          +
        </button>
      </div>
    </main>
  );
}
