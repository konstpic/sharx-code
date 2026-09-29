import { Game } from "./game";

/** Mounts the game into `host`. Returns a dispose function. */
export function mountNetTrace(host: HTMLElement, onExit: () => void): () => void {
  let game: Game | null = null;
  try {
    game = new Game(host, onExit);
  } catch (err) {
    console.error("[nettrace] failed to start", err);
    const msg = document.createElement("div");
    msg.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;color:#fca5a5;font:14px ui-monospace,monospace;text-align:center;padding:24px";
    msg.innerHTML = "WebGL is not available in this browser.<br/><small style='color:#64748b'>Press Esc to close.</small>";
    host.appendChild(msg);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onExit();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      msg.remove();
    };
  }
  return () => game?.dispose();
}
