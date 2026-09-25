"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ScenePlayerBar, type ScenePlayer } from "@/components/help/player";

const GREEN = "#22c55e";
const ROSE = "#f43f5e";
const SKY = "#38bdf8";
const AMBER = "#f59e0b";
const ACC = "var(--accent)";

// Positions in the 800 x 450 stage.
const CLIENT = { x: 110, y: 240 };
const HUB = { x: 392, y: 240 };
const NODE_A = { x: 664, y: 132 };
const NODE_B = { x: 664, y: 340 };
const BUNDLE = { x: 392, y: 74 };

const EASE = { type: "spring", stiffness: 260, damping: 24 } as const;

const P_CLIENT_HUB = "M 156 240 C 214 240, 262 240, 344 240";
const P_HUB_A = "M 440 226 C 520 214, 560 152, 586 140";
const P_HUB_B = "M 440 254 C 520 266, 560 330, 586 340";

const glass = {
  fill: "color-mix(in oklab, var(--surface) 82%, transparent)",
  stroke: "color-mix(in oklab, var(--fg) 20%, transparent)",
  strokeWidth: 1.6,
} as const;
const mono = { fill: "var(--fg)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as const;

type Pt = { x: number; y: number };

function bez(a: [number, number], b: [number, number], c: [number, number], d: [number, number], n = 12): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return {
      x: u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      y: u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    };
  });
}

/** A route: a faint rail plus a marching dash. Turns dashed rose when the node behind it is down. */
function Route({ d, color, down = false }: { d: string; color: string; down?: boolean }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke={down ? ROSE : "var(--fg-subtle)"} strokeWidth={2} opacity={down ? 0.55 : 0.28} strokeDasharray={down ? "3 8" : undefined} />
      {!down ? (
        <path d={d} stroke={color} strokeWidth={2.4} strokeDasharray="6 14" opacity={0.7}>
          <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />
        </path>
      ) : null}
    </g>
  );
}

/** A light pulse travelling along a path with a short tail, repeating with a pause. */
function Pulse({ path, color, begin, dur = 1.2, gap = 1.9 }: { path: string; color: string; begin: number; dur?: number; gap?: number }) {
  const cycle = dur + gap;
  const f = dur / cycle;
  return (
    <g style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      {[0, 0.07, 0.14, 0.21].map((d, i) => (
        <circle key={i} r={5.2 - i * 1.1} fill={color} opacity={0}>
          <animateMotion dur={`${cycle}s`} begin={`${begin + d}s`} repeatCount="indefinite" path={path} keyPoints="0;1;1" keyTimes={`0;${f.toFixed(3)};1`} calcMode="linear" />
          <animate attributeName="opacity" values="0;1;1;0;0" keyTimes={`0;0.05;${(f - 0.05).toFixed(3)};${f.toFixed(3)};1`} dur={`${cycle}s`} begin={`${begin + d}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

function StatusDot({ x, y, down }: { x: number; y: number; down: boolean }) {
  const c = down ? ROSE : GREEN;
  return (
    <g>
      <circle cx={x} cy={y} r={4.6} fill={c} />
      {!down ? (
        <circle cx={x} cy={y} r={4.6} fill="none" stroke={c} strokeWidth={1.6}>
          <animate attributeName="r" values="4.6;11" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0" dur="1.8s" repeatCount="indefinite" />
        </circle>
      ) : null}
    </g>
  );
}

function NodeCard({ at, label, down, delay, meta }: { at: Pt; label: string; down: boolean; delay: number; meta: string }) {
  const w = 156;
  const h = 92;
  const bars = [0.72, 0.46, 0.6];
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <motion.g initial={{ opacity: 0, y: 18 }} animate={{ opacity: down ? 0.62 : 1, y: 0 }} transition={{ ...EASE, delay }}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={16} {...glass} style={{ stroke: down ? ROSE : "color-mix(in oklab, var(--accent) 60%, transparent)" }} />
        <g transform={`translate(${-w / 2 + 16} ${-h / 2 + 15})`} fill="none" strokeWidth={2} style={{ stroke: "var(--fg-muted)" }}>
          <rect x={0} y={0} width={20} height={7} rx={2.4} />
          <rect x={0} y={10} width={20} height={7} rx={2.4} />
          <circle cx={4.5} cy={3.5} r={1.1} fill={down ? ROSE : GREEN} stroke="none" />
          <circle cx={4.5} cy={13.5} r={1.1} fill={down ? ROSE : GREEN} stroke="none" />
        </g>
        <text x={-w / 2 + 44} y={-h / 2 + 30} fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
          {label}
        </text>
        <StatusDot x={w / 2 - 20} y={-h / 2 + 24} down={down} />
        <text x={-w / 2 + 16} y={-h / 2 + 52} fontSize={12.5} style={{ ...mono, fill: "var(--fg-subtle)" }}>
          {meta}
        </text>
        {bars.map((v, i) => (
          <g key={i} transform={`translate(${-w / 2 + 16} ${-h / 2 + 62 + i * 8})`}>
            <rect width={w - 32} height={4.4} rx={2.2} style={{ fill: "color-mix(in oklab, var(--fg) 12%, transparent)" }} />
            <rect width={down ? 4 : (w - 32) * v} height={4.4} rx={2.2} fill={down ? ROSE : i === 0 ? ACC : SKY} opacity={0.9}>
              {!down ? <animate attributeName="width" values={`${(w - 32) * v};${(w - 32) * Math.min(0.95, v + 0.18)};${(w - 32) * v}`} dur={`${2.4 + i * 0.7}s`} repeatCount="indefinite" /> : null}
            </rect>
          </g>
        ))}
        {down ? (
          <g transform={`translate(${w / 2 - 20} ${h / 2 - 18})`}>
            <circle r={11} fill={ROSE} />
            <path d="M -4.5 -4.5 L 4.5 4.5 M 4.5 -4.5 L -4.5 4.5" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
          </g>
        ) : null}
      </motion.g>
    </g>
  );
}

function HubCard({ label, failover }: { label: string; failover: boolean }) {
  const c = failover ? AMBER : GREEN;
  return (
    <g transform={`translate(${HUB.x} ${HUB.y})`}>
      <motion.g initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={EASE} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <circle r={64} fill="none" stroke={c} strokeWidth={1.4} strokeDasharray="3 9" opacity={0.6}>
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="24s" repeatCount="indefinite" />
        </circle>
        <circle r={50} {...glass} style={{ stroke: c }} />
        <circle r={50} fill="url(#hubGlow)" />
        <g fill="none" stroke={c} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M -22 4 L 0 4 L 20 -14 M 0 4 L 20 22" />
          <path d="M 12 -14 L 20 -14 L 20 -6 M 12 22 L 20 22 L 20 14" />
          <circle cx={-24} cy={4} r={3} fill={c} stroke="none" />
        </g>
      </motion.g>
      <text x={0} y={88} textAnchor="middle" fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
        {label}
      </text>
    </g>
  );
}

function ClientCard({ label }: { label: string }) {
  return (
    <g transform={`translate(${CLIENT.x} ${CLIENT.y})`}>
      <motion.g initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={EASE}>
        <rect x={-36} y={-64} width={72} height={128} rx={17} {...glass} style={{ stroke: SKY }} />
        <rect x={-13} y={-56} width={26} height={4.6} rx={2.3} fill={SKY} opacity={0.6} />
        {[0, 1, 2].map((i) => (
          <motion.g key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...EASE, delay: 0.5 + i * 0.12 }}>
            <rect x={-26} y={-34 + i * 24} width={52} height={18} rx={6} style={{ fill: "color-mix(in oklab, var(--fg) 10%, transparent)" }} />
            <circle cx={-17} cy={-25 + i * 24} r={3.4} fill={i === 0 ? GREEN : SKY} />
            <rect x={-8} y={-27.5 + i * 24} width={26} height={5} rx={2.5} style={{ fill: "var(--fg-subtle)" }} opacity={0.7} />
          </motion.g>
        ))}
        <motion.g initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...EASE, delay: 1.1 }} transform="translate(30 -60)">
          <circle r={11} fill={GREEN} />
          <path d="M -5 0.5 L -1.5 4 L 5.5 -3.5" stroke="#fff" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </motion.g>
      </motion.g>
      <text x={0} y={92} textAnchor="middle" fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
        {label}
      </text>
    </g>
  );
}

function BundleCard({ label, count }: { label: string; count: number }) {
  return (
    <g transform={`translate(${BUNDLE.x} ${BUNDLE.y})`}>
      <motion.g initial={{ opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }} transition={EASE}>
        <rect x={-66} y={-30} width={132} height={62} rx={14} {...glass} opacity={0.4} transform="translate(10 8)" />
        <rect x={-66} y={-30} width={132} height={62} rx={14} {...glass} opacity={0.65} transform="translate(5 4)" />
        <rect x={-66} y={-30} width={132} height={62} rx={14} {...glass} style={{ stroke: ACC }} />
        <g transform="translate(-52 -12)" fill="none" stroke={ACC} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round">
          <path d="M 12 0 L 24 6 L 24 20 L 12 26 L 0 20 L 0 6 Z" />
          <path d="M 0 6 L 12 12 L 24 6 M 12 12 L 12 26" />
        </g>
        <text x={-20} y={7} fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
          {label}
        </text>
        <g transform="translate(50 -1)">
          <circle r={13} style={{ fill: ACC }} />
          <text x={0} y={5.4} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff">
            {count}
          </text>
        </g>
      </motion.g>
    </g>
  );
}

function HostChip({ x, y, text, delay, fly }: { x: number; y: number; text: string; delay: number; fly: boolean }) {
  const w = 150;
  const chip = (
    <>
      <rect x={-w / 2} y={-13} width={w} height={26} rx={13} {...glass} style={{ stroke: AMBER }} />
      <circle cx={-w / 2 + 14} cy={0} r={3.6} fill={AMBER} />
      <text x={6} y={5} textAnchor="middle" fontSize={13.5} style={mono}>
        {text}
      </text>
    </>
  );
  if (!fly) {
    return (
      <g transform={`translate(${x} ${y})`}>
        <motion.g initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...EASE, delay }}>
          {chip}
        </motion.g>
      </g>
    );
  }
  return (
    <motion.g
      initial={{ x, y, opacity: 0 }}
      animate={{ x: [x, x, BUNDLE.x, BUNDLE.x], y: [y, y - 16, BUNDLE.y - 6, BUNDLE.y + 6], opacity: [0, 1, 1, 0], scale: [1, 1.05, 0.7, 0.4] }}
      transition={{ duration: 1.5, delay, times: [0, 0.2, 0.8, 1], ease: "easeInOut" }}
    >
      {chip}
    </motion.g>
  );
}

/** The subscription link travelling from the bundle to the client. */
function Ticket() {
  const pts = bez([BUNDLE.x - 60, BUNDLE.y + 20], [250, 60], [170, 130], [CLIENT.x, CLIENT.y - 76]);
  const n = pts.length;
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ x: pts.map((p) => p.x), y: pts.map((p) => p.y), opacity: pts.map((_, i) => (i === 0 || i === n - 1 ? 0 : 1)), scale: pts.map((_, i) => (i > n - 4 ? 0.7 : 1)) }}
      transition={{ duration: 2.2, delay: 0.5, ease: "easeInOut" }}
    >
      <rect x={-30} y={-14} width={60} height={28} rx={14} {...glass} style={{ stroke: GREEN }} />
      <path d="M -13 2 a5.5 5.5 0 0 1 0 -8 l3.4 -3 M 13 -2 a5.5 5.5 0 0 1 0 8 l-3.4 3 M -7 0 L 7 0" stroke={GREEN} strokeWidth={2.4} fill="none" strokeLinecap="round" />
    </motion.g>
  );
}

/** The dashboard's story: servers, balancer, hosts, bundle, client, traffic and a node failing over. */
export function WelcomeStory({ player, captionKeys, compact }: { player: ScenePlayer; captionKeys: string[]; compact?: boolean }) {
  const { t } = useTranslation();
  const { step, reduce } = player;
  const lab = (k: string) => t(`pages.help.scenes.common.${k}`);
  const downB = step === 6;
  const dynamic = !reduce;

  return (
    <div>
      <div
        className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--border)]"
        style={{ background: "radial-gradient(70% 90% at 50% 40%, color-mix(in oklab, var(--accent) 12%, var(--bg-elevated)) 0%, var(--bg) 100%)" }}
        role="img"
        aria-label={lab("bundle")}
      >
        <svg viewBox="0 0 800 450" className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="wsDots" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.1" style={{ fill: "var(--fg)" }} opacity={0.16} />
            </pattern>
            <radialGradient id="wsFade" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="#fff" stopOpacity={1} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </radialGradient>
            <mask id="wsMask">
              <rect width="800" height="450" fill="url(#wsFade)" />
            </mask>
            <radialGradient id="hubGlow" cx="50%" cy="35%" r="70%">
              <stop offset="0%" stopColor={GREEN} stopOpacity={0.22} />
              <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
            </radialGradient>
          </defs>
          <rect width="800" height="450" fill="url(#wsDots)" mask="url(#wsMask)" />

          {step >= 1 ? <Route d={P_HUB_A} color={GREEN} /> : null}
          {step >= 1 ? <Route d={P_HUB_B} color={GREEN} down={downB} /> : null}
          {step >= 4 ? <Route d={P_CLIENT_HUB} color={SKY} /> : null}

          <NodeCard at={NODE_A} label={lab("nodeA")} down={false} delay={0} meta="VLESS · :443" />
          <NodeCard at={NODE_B} label={lab("nodeB")} down={downB} delay={0.12} meta="VLESS · :443" />

          {step >= 1 ? <HubCard label={lab("balancer")} failover={downB} /> : null}

          {step >= 2 ? (
            <>
              <HostChip x={HUB.x} y={HUB.y + 122} text="lb.example.com" delay={0} fly={false} />
              <HostChip x={NODE_A.x} y={NODE_A.y + 74} text="a.example.com" delay={0.2} fly={false} />
              <HostChip x={NODE_B.x} y={NODE_B.y + 74} text="b.example.com" delay={0.4} fly={false} />
            </>
          ) : null}

          {step >= 3 ? <BundleCard label={lab("bundle")} count={step === 3 ? 0 : 3} /> : null}
          {step === 3 ? (
            <>
              <HostChip x={HUB.x} y={HUB.y + 122} text="lb.example.com" delay={0.8} fly />
              <HostChip x={NODE_A.x} y={NODE_A.y + 74} text="a.example.com" delay={1.2} fly />
              <HostChip x={NODE_B.x} y={NODE_B.y + 74} text="b.example.com" delay={1.6} fly />
            </>
          ) : null}

          {step >= 4 ? <ClientCard label={lab("client")} /> : null}
          {step === 4 ? <Ticket /> : null}

          {step >= 5 && dynamic ? (
            <>
              <Pulse path={P_CLIENT_HUB} color={SKY} begin={0} />
              {step === 5 ? (
                <>
                  <Pulse path={P_HUB_A} color={GREEN} begin={1.0} />
                  <Pulse path={P_HUB_B} color={GREEN} begin={2.6} />
                </>
              ) : (
                <Pulse path={P_HUB_A} color={GREEN} begin={1.0} gap={0.6} />
              )}
            </>
          ) : null}
        </svg>
      </div>
      <ScenePlayerBar player={player} caption={t(captionKeys[Math.min(step, captionKeys.length - 1)])} compact={compact} />
    </div>
  );
}
