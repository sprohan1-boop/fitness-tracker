// AI settings (your own API key) and the AI coach chat.
import { ExternalLink, KeyRound, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api";
import { askCoach, friendlyError, getApiKey, setApiKey, testApiKey } from "./ai";
import type { ChatTurn } from "./ai";
import { FormError } from "./ui";
import { localDate } from "./utils";

/** Settings card: add, test or remove the Anthropic API key used for AI features. */
export function AiSettings({ onChanged }: { onChanged: (ready: boolean) => void }) {
  const [saved, setSaved] = useState(Boolean(getApiKey()));
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!key.trim()) return;
    setApiKey(key);
    setStatus("testing");
    try {
      await testApiKey();
      setSaved(true);
      setKey("");
      setStatus("ok");
      setMessage("Key works. AI features are on.");
      onChanged(true);
    } catch (cause) {
      setApiKey(null);
      setStatus("error");
      setMessage(await friendlyError(cause));
    }
  }

  function remove() {
    setApiKey(null);
    setSaved(false);
    setStatus("idle");
    setMessage("");
    onChanged(false);
  }

  return (
    <section className="mt-4 rounded-3xl border border-line bg-panel p-4 sm:p-6">
      <div className="flex items-center gap-2"><Sparkles size={16} className="text-amber-300" /><h3 className="font-semibold">AI features</h3></div>
      <p className="mt-2 text-xs leading-5 text-muted">
        Optional. Uses Claude Haiku 5.5 with your own Anthropic API key, for meal photos, dishes the database doesn't know, and the AI coach.
        Typical cost is about ₹10 a month, billed by Anthropic to you. Typed logging works free without this.
      </p>
      {saved ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-night px-3.5 py-3">
          <span className="flex items-center gap-2 text-xs"><KeyRound size={14} className="text-lime" /> API key saved on this phone</span>
          <button onClick={remove} className="text-xs font-semibold text-red-200">Remove</button>
        </div>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-2">
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your API key (sk-ant-…)" className="input-dark" aria-label="Anthropic API key" />
          <button disabled={!key.trim() || status === "testing"} className="button-primary w-full disabled:opacity-60">
            {status === "testing" ? <><Loader2 size={15} className="animate-spin" /> Checking key…</> : "Save and test key"}
          </button>
        </form>
      )}
      {message && (status === "error" ? <div className="mt-2"><FormError message={message} /></div> : <p className="mt-2 text-xs text-mint">{message}</p>)}
      <ul className="mt-4 space-y-1.5 text-[11px] leading-4 text-muted">
        <li>• Create a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-sky-300">console.anthropic.com <ExternalLink size={10} className="inline" /></a>, and set a monthly spend limit there.</li>
        <li>• The key stays only on this phone. It isn't in backups or the app's code.</li>
        <li>• Only what you use is sent to Anthropic: the meal you typed or photographed, or a summary of your recent logs when you ask the coach.</li>
        <li>• AI estimates are labelled and never saved until you confirm them. The coach isn't medical advice.</li>
      </ul>
    </section>
  );
}

const STARTERS = ["How was my week?", "Am I eating enough protein?", "What should I eat for dinner today?", "Am I on track for my goals?", "How can I improve my workouts?"];

/** Chat with the AI coach about your own data. The conversation isn't stored. */
export function CoachChat({ aiReady, onSetUp }: { aiReady: boolean; onSetUp: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, streaming]);

  async function send(question: string) {
    if (!question.trim() || streaming !== null) return;
    const history: ChatTurn[] = [...turns, { role: "user", content: question.trim() }];
    setTurns(history);
    setInput("");
    setError("");
    setStreaming("");
    try {
      const snapshot = await api.coachSnapshot(localDate());
      const reply = await askCoach(history, snapshot, (delta) => setStreaming((current) => (current ?? "") + delta));
      setTurns([...history, { role: "assistant", content: reply }]);
    } catch (cause) {
      setError(await friendlyError(cause));
      setTurns(turns); // let them try the question again
      setInput(question);
    } finally {
      setStreaming(null);
    }
  }

  if (!aiReady) {
    return (
      <div className="space-y-3 text-center">
        <Sparkles className="mx-auto text-amber-300" size={24} />
        <p className="text-sm font-medium">The AI coach needs your API key</p>
        <p className="text-xs leading-5 text-muted">Add an Anthropic API key in Settings → AI features. With Claude Haiku 5.5 a question costs well under ₹1.</p>
        <button onClick={onSetUp} className="button-primary w-full">Set up AI</button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50dvh] flex-col">
      <div className="flex-1 space-y-3">
        {turns.length === 0 && (
          <div>
            <p className="text-xs leading-5 text-muted">Ask about your food, training, sleep or goals. The coach sees a summary of your last two weeks each time you ask.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {STARTERS.map((starter) => <button key={starter} onClick={() => void send(starter)} className="rounded-full border border-amber-300/30 px-3 py-1.5 text-[11px] text-amber-300">{starter}</button>)}
            </div>
          </div>
        )}
        {turns.map((turn, index) => <Bubble key={index} turn={turn} />)}
        {streaming !== null && (
          streaming ? <Bubble turn={{ role: "assistant", content: streaming }} /> : <p className="flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" /> Looking at your data…</p>
        )}
        {error && <FormError message={error} />}
        <div ref={end} />
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void send(input); }} className="sticky bottom-0 -mx-5 mt-3 flex gap-2 border-t border-line bg-panel px-5 pt-3 sm:-mx-6 sm:px-6">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask your coach…" className="input-dark" aria-label="Message the coach" />
        <button disabled={!input.trim() || streaming !== null} className="button-primary !px-3.5 disabled:opacity-50" aria-label="Send"><Send size={16} /></button>
      </form>
      <p className="mt-2 text-[10px] text-muted">AI coach (Claude Haiku 5.5). General guidance, not medical advice.</p>
    </div>
  );
}

function Bubble({ turn }: { turn: ChatTurn }) {
  const mine = turn.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-5 ${mine ? "bg-lime/15 text-white" : "bg-night text-zinc-200"}`}>{turn.content}</div>
    </div>
  );
}
