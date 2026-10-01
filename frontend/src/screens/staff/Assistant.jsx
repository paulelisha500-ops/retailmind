import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../api.js";
import { useSession } from "../../session.jsx";
import { IconButton, Input } from "../../ui/controls.jsx";
import { Banner, Skeleton, Tag } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";

const SUGGESTIONS = [
  "Which products need attention this week?",
  "Which supplier performs best?",
  "Is dairy demand actually decreasing?",
  "Any security concerns today?",
  "What should I restock first?",
];

export default function Assistant({ onNav }) {
  const { token, activeStoreId } = useSession();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, pending]);

  async function ask(text) {
    const question = text.trim();
    if (!question || pending) return;
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setPending(true);
    try {
      const answer = await apiFetch("/assistant/ask", { method: "POST", token, body: { question, store_id: activeStoreId } });
      setMessages((prev) => [...prev, { role: "assistant", text: answer.text, agent: answer.agent, tone: answer.tone }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", text: `I couldn't answer that: ${err.message || "the request failed"}`, agent: "RetailMind", tone: "red" }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="screen screen--narrow">
      <ScreenHeader title="Ask RetailMind" subtitle="Answers grounded in this store's live data" back={{ label: "Home", tid: "assistant.back", onClick: () => onNav("home") }} />

      {messages.length === 0 && <Banner tone="plain">Each answer is computed from live inventory, suppliers, sales and alerts — never a canned reply.</Banner>}

      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`bubble-row bubble-row--${m.role}`}>
            {m.role === "assistant" && <Tag tone={m.tone}>{m.agent}</Tag>}
            <div className={`bubble bubble--${m.role}`}>{m.text}</div>
          </div>
        ))}
        {pending && <div className="bubble-row bubble-row--assistant"><div className="bubble bubble--assistant" style={{ width: 160 }}><Skeleton lines={1} /></div></div>}
        <div ref={endRef} />
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map((s) => <button key={s} type="button" data-tid="assistant.suggestion" className="suggestion" disabled={pending} onClick={() => ask(s)}>{s}</button>)}
      </div>

      <form className="chat-bar" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <Input tid="assistant.input" placeholder="Ask about stock, suppliers, forecasts…" aria-label="Your question" value={input} onChange={(e) => setInput(e.target.value)} disabled={pending} />
        <IconButton label="Send" tid="assistant.send" className="chat-send" type="submit" disabled={pending || !input.trim()}><Send size={17} aria-hidden="true" /></IconButton>
      </form>
    </div>
  );
}

