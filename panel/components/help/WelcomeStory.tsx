"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ScenePlayerBar, type ScenePlayer } from "@/components/help/player";

const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const ROSE = "#f43f5e";
const SKY = "#38bdf8";
const ACC = "var(--accent)";

// Positions in the 800 x 450 stage.
const PHONE = { x: 118, base: 350 };
const HUB = { x: 402, base: 318 };
const TOWER_A = { x: 664, base: 194 };
const TOWER_B = { x: 664, base: 380 };
const BOX = { x: 402, y: 92 };

const POP = { type: "spring", stiffness: 300, damping: 15 } as const;

/** Sample a cubic bezier so framer can fly an object along it. */
function bez(p: [number, number][], n = 10) {
  const [a, b, c, d] = p;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      y: u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    });
  }
  return pts;
}

const PATH_PHONE_HUB = "M 156 290 C 220 236, 300 236, 358 282";
const PATH_HUB_A = "M 446 270 C 520 250, 560 180, 626 150";
const PATH_HUB_B = "M 446 296 C 520 318, 566 338, 626 338";

function Sparkle({ x, y, delay = 0, color = AMBER }: { x: number; y: number; delay?: number; color?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 -9 L2.4 -2.4 L9 0 L2.4 2.4 L0 9 L-2.4 2.4 L-9 0 L-2.4 -2.4 Z" fill={color}>
        <animateTransform attributeName="transform" type="scale" values="0.2;1;0.2" dur="1.6s" begin={`${delay}s`} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;0" dur="1.6s" begin={`${delay}s`} repeatCount="indefinite" />
      </path>
    </g>
  );
}

function Eyes({ cx, cy, gap, r, asleep, look = { x: 0, y: 0 }, color = "#fff" }: { cx: number; cy: number; gap: number; r: number; asleep?: boolean; look?: { x: number; y: number }; color?: string }) {
  if (asleep) {
    return (
      <g stroke="#0b1020" strokeWidth={2.6} strokeLinecap="round" fill="none">
        <path d={`M ${cx - gap - r} ${cy} q ${r} ${r * 0.9} ${r * 2} 0`} />
        <path d={`M ${cx + gap - r} ${cy} q ${r} ${r * 0.9} ${r * 2} 0`} />
      </g>
    );
  }
  return (
    <g>
      {[-gap, gap].map((dx) => (
        <g key={dx}>
          <ellipse cx={cx + dx} cy={cy} rx={r} ry={r} fill={color}>
            <animate attributeName="ry" values={`${r};${r};${r * 0.12};${r}`} keyTimes="0;0.9;0.94;1" dur="4.4s" repeatCount="indefinite" />
          </ellipse>
          <motion.circle
            cx={cx + dx}
            cy={cy}
            r={r * 0.46}
            fill="#0b1020"
            initial={false}
            animate={{ x: look.x, y: look.y }}
            transition={{ type: "spring", stiffness: 160, damping: 14 }}
          />
        </g>
      ))}
    </g>
  );
}

function Tower({ cx, base, asleep, label, delay }: { cx: number; base: number; asleep: boolean; label: string; delay: number }) {
  const rows = [-62, -42, -22];
  return (
    <g transform={`translate(${cx} ${base})`}>
     <g transform="scale(0.82)">
      <ellipse cx={0} cy={8} rx={52} ry={9} fill="#000" opacity={0.28} />
      <motion.g
        initial={{ y: 44, opacity: 0, scaleY: 0.6 }}
        animate={{ y: 0, opacity: 1, scaleY: 1 }}
        transition={{ ...POP, delay }}
        style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
      >
        {/* antenna */}
        <line x1={0} y1={-112} x2={0} y2={-130} stroke="var(--fg-subtle)" strokeWidth={3} strokeLinecap="round" />
        <circle cx={0} cy={-134} r={5.5} fill={asleep ? ROSE : GREEN}>
          {!asleep ? <animate attributeName="opacity" values="1;0.25;1" dur="1.3s" repeatCount="indefinite" /> : null}
        </circle>
        {/* body */}
        <rect x={-44} y={-112} width={88} height={112} rx={16} style={{ fill: "color-mix(in oklab, var(--surface) 92%, var(--accent))", stroke: asleep ? ROSE : ACC, strokeWidth: 2.5 }} opacity={asleep ? 0.75 : 1} />
        <rect x={-44} y={-112} width={88} height={30} rx={16} style={{ fill: "color-mix(in oklab, var(--accent) 22%, transparent)" }} />
        <rect x={-34} y={-104} width={68} height={30} rx={10} fill="#0d1224" />
        <Eyes cx={0} cy={-89} gap={13} r={6.4} asleep={asleep} look={{ x: -1.2, y: 0.8 }} color="#e6f1ff" />
        {asleep ? <path d="M -5 -78 q5 3 10 0" stroke="#e6f1ff" strokeWidth={2} fill="none" strokeLinecap="round" /> : <path d="M -6 -78 q6 5 12 0" stroke="#e6f1ff" strokeWidth={2} fill="none" strokeLinecap="round" />}
        {/* slots */}
        {rows.map((y, i) => (
          <g key={y}>
            <rect x={-34} y={y - 6} width={68} height={13} rx={5} fill="#0d1224" />
            {[0, 1].map((k) => (
              <circle key={k} cx={-24 + k * 11} cy={y + 0.5} r={3} fill={asleep ? ROSE : k === 0 ? GREEN : AMBER} opacity={asleep ? 0.85 : 1}>
                {!asleep ? <animate attributeName="opacity" values="1;0.2;1" dur={`${1.1 + i * 0.35 + k * 0.2}s`} repeatCount="indefinite" /> : null}
              </circle>
            ))}
            <rect x={2} y={y - 1.5} width={26} height={4} rx={2} fill="var(--fg-subtle)" opacity={0.5} />
          </g>
        ))}
      </motion.g>
      {asleep ? (
        <g fill={ROSE} fontWeight={700}>
          {[0, 1, 2].map((i) => (
            <text key={i} x={36 + i * 8} y={-118 - i * 10} fontSize={16 + i * 4} opacity={0}>
              z
              <animate attributeName="opacity" values="0;1;0" dur="2.4s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0 0;10 -16" dur="2.4s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
            </text>
          ))}
        </g>
      ) : null}
     </g>
      <text x={0} y={28} textAnchor="middle" fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
        {label}
      </text>
    </g>
  );
}

function Hub({ label, look }: { label: string; look: { x: number; y: number } }) {
  return (
    <g transform={`translate(${HUB.x} ${HUB.base})`}>
      <ellipse cx={0} cy={22} rx={78} ry={16} fill="#000" opacity={0.28} />
      <motion.g initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={POP} style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
        <circle cx={0} cy={-46} r={56} fill="none" stroke={GREEN} strokeWidth={3} strokeDasharray="10 9" opacity={0.75}>
          <animateTransform attributeName="transform" type="rotate" from="0 0 -46" to="360 0 -46" dur="16s" repeatCount="indefinite" />
        </circle>
        <g>
          <animateTransform attributeName="transform" type="rotate" from="0 0 -46" to="-360 0 -46" dur="9s" repeatCount="indefinite" />
          {[0, 120, 240].map((a) => (
            <path key={a} d="M -7 -100 L 0 -110 L 7 -100" stroke={GREEN} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" transform={`rotate(${a} 0 -46)`} />
          ))}
        </g>
        <circle cx={0} cy={-46} r={42} style={{ fill: "color-mix(in oklab, var(--surface) 86%, #22c55e)", stroke: GREEN, strokeWidth: 3 }} />
        <circle cx={0} cy={-46} r={42} fill="url(#hubShine)" />
        <Eyes cx={0} cy={-52} gap={14} r={8} look={look} />
        <path d="M -12 -32 q12 12 24 0" stroke="#0b1020" strokeWidth={3} fill="none" strokeLinecap="round" />
        <circle cx={-27} cy={-38} r={5} fill={ROSE} opacity={0.35} />
        <circle cx={27} cy={-38} r={5} fill={ROSE} opacity={0.35} />
      </motion.g>
      <text x={0} y={44} textAnchor="middle" fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
        {label}
      </text>
    </g>
  );
}

function Phone({ label, happy, waving }: { label: string; happy: boolean; waving: boolean }) {
  return (
    <g transform={`translate(${PHONE.x} ${PHONE.base})`}>
      <ellipse cx={0} cy={8} rx={46} ry={8} fill="#000" opacity={0.28} />
      <motion.g initial={{ x: -90, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 120, damping: 14 }}>
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="1.8s" repeatCount="indefinite" />
          <rect x={-34} y={-116} width={68} height={116} rx={16} style={{ fill: "color-mix(in oklab, var(--surface) 90%, #38bdf8)", stroke: SKY, strokeWidth: 2.5 }} />
          <rect x={-27} y={-106} width={54} height={92} rx={10} fill="#0d1224" />
          <rect x={-9} y={-112} width={18} height={3.6} rx={2} fill={SKY} opacity={0.6} />
          <Eyes cx={0} cy={-72} gap={12} r={6.6} look={{ x: 1.2, y: 0.4 }} color="#e6f1ff" />
          {happy ? (
            <path d="M -13 -52 q13 16 26 0 q-13 4 -26 0 Z" fill="#e6f1ff" stroke="#e6f1ff" strokeWidth={2} strokeLinejoin="round" />
          ) : (
            <path d="M -9 -50 q9 7 18 0" stroke="#e6f1ff" strokeWidth={2.6} fill="none" strokeLinecap="round" />
          )}
          <circle cx={-19} cy={-58} r={4.6} fill={ROSE} opacity={0.4} />
          <circle cx={19} cy={-58} r={4.6} fill={ROSE} opacity={0.4} />
          <rect x={-18} y={-32} width={36} height={8} rx={4} fill={SKY} opacity={0.25} />
          {/* waving hand */}
          <motion.g
            style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
            animate={waving ? { rotate: [0, 24, -8, 24, 0] } : { rotate: 0 }}
            transition={{ duration: 1.6, repeat: waving ? Infinity : 0, repeatDelay: 0.8 }}
          >
            <circle cx={46} cy={-64} r={8.5} fill="#ffd8a8" stroke="#e9b57a" strokeWidth={1.5} />
          </motion.g>
        </g>
        {happy ? (
          <motion.path
            d="M0 -6 C-14 -20 -26 -4 0 14 C26 -4 14 -20 0 -6 Z"
            fill={ROSE}
            initial={{ scale: 0, opacity: 0, x: 44, y: -128 }}
            animate={{ scale: [0, 1.2, 1], opacity: [0, 1, 1, 0], x: 44, y: [-128, -150, -170] }}
            transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1 }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        ) : null}
      </motion.g>
      <text x={0} y={34} textAnchor="middle" fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
        {label}
      </text>
    </g>
  );
}

function Signpost({ x, y, text, delay }: { x: number; y: number; text: string; delay: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <motion.g initial={{ scaleY: 0, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }} transition={{ ...POP, delay }} style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
        <rect x={-3} y={-2} width={6} height={22} rx={2} fill="var(--fg-subtle)" />
        <g>
          <animateTransform attributeName="transform" type="rotate" values="-1.6 0 0;1.6 0 0;-1.6 0 0" dur="3s" repeatCount="indefinite" />
          <rect x={-70} y={-26} width={140} height={28} rx={9} style={{ fill: "color-mix(in oklab, var(--surface) 85%, #f59e0b)", stroke: AMBER, strokeWidth: 2 }} />
          <circle cx={-56} cy={-12} r={4} fill={AMBER} />
          <text x={6} y={-6.5} textAnchor="middle" fontSize={15} fontWeight={600} style={{ fill: "var(--fg)" }}>
            {text}
          </text>
        </g>
      </motion.g>
    </g>
  );
}

function Tag({ from, delay, text }: { from: { x: number; y: number }; delay: number; text: string }) {
  return (
    <motion.g
      initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.9 }}
      animate={{ x: [from.x, from.x, BOX.x, BOX.x], y: [from.y, from.y - 20, BOX.y - 8, BOX.y + 12], opacity: [0, 1, 1, 0], scale: [0.9, 1.1, 0.7, 0.35] }}
      transition={{ duration: 1.6, delay, times: [0, 0.2, 0.8, 1], ease: "easeInOut" }}
    >
      <rect x={-46} y={-11} width={92} height={22} rx={8} style={{ fill: "color-mix(in oklab, var(--surface) 80%, #f59e0b)", stroke: AMBER, strokeWidth: 2 }} />
      <circle cx={-34} cy={0} r={3.4} fill={AMBER} />
      <text x={6} y={5} textAnchor="middle" fontSize={12.5} fontWeight={600} style={{ fill: "var(--fg)" }}>
        {text}
      </text>
    </motion.g>
  );
}

function Box({ label, play }: { label: string; play: boolean }) {
  return (
    <g transform={`translate(${BOX.x} ${BOX.y})`}>
      <ellipse cx={0} cy={58} rx={64} ry={10} fill="#000" opacity={0.25} />
      <motion.g initial={{ scale: 0, y: 30 }} animate={{ scale: 1, y: 0 }} transition={POP} style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}>
        <rect x={-52} y={2} width={104} height={54} rx={9} style={{ fill: "color-mix(in oklab, var(--accent) 48%, var(--surface))", stroke: ACC, strokeWidth: 2.5 }} />
        <rect x={-8} y={2} width={16} height={54} style={{ fill: AMBER }} opacity={0.95} />
        <motion.g
          key={play ? "anim" : "still"}
          style={{ transformBox: "view-box", transformOrigin: "-52px 2px" }}
          initial={false}
          animate={play ? { rotate: [0, -62, -62, 0] } : { rotate: 0 }}
          transition={{ duration: 3.2, times: [0, 0.16, 0.7, 1], ease: "easeInOut" }}
        >
          <rect x={-58} y={-22} width={116} height={26} rx={9} style={{ fill: "color-mix(in oklab, var(--accent) 62%, var(--surface))", stroke: ACC, strokeWidth: 2.5 }} />
          <rect x={-8} y={-22} width={16} height={26} style={{ fill: AMBER }} />
          <ellipse cx={-14} cy={-28} rx={15} ry={9} fill="none" stroke={AMBER} strokeWidth={5} transform="rotate(-18 -14 -28)" />
          <ellipse cx={14} cy={-28} rx={15} ry={9} fill="none" stroke={AMBER} strokeWidth={5} transform="rotate(18 14 -28)" />
          <circle cx={0} cy={-25} r={6} fill={AMBER} />
        </motion.g>
      </motion.g>
      <text x={0} y={82} textAnchor="middle" fontSize={19} fontWeight={600} style={{ fill: "var(--fg)" }}>
        {label}
      </text>
      <Sparkle x={-70} y={-6} delay={0.2} />
      <Sparkle x={72} y={10} delay={0.9} color={SKY} />
      <Sparkle x={54} y={-30} delay={1.3} color={GREEN} />
    </g>
  );
}

function Ticket() {
  const pts = bez([[BOX.x - 50, BOX.y + 10], [270, 70], [170, 130], [PHONE.x + 8, PHONE.base - 132]], 10);
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ x: pts.map((p) => p.x), y: pts.map((p) => p.y), opacity: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0], scale: [0.3, 1, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.4], rotate: [0, -10, 8, -8, 8, -6, 6, -4, 4, 0, 0] }}
      transition={{ duration: 2.4, delay: 0.6, ease: "easeInOut" }}
    >
      <rect x={-27} y={-15} width={54} height={30} rx={8} fill="#fff" stroke={GREEN} strokeWidth={2.5} />
      <path d="M -13 3 a6 6 0 0 1 0 -9 l4 -3 M 13 -3 a6 6 0 0 1 0 9 l-4 3 M -8 0 L 8 0" stroke={GREEN} strokeWidth={3} fill="none" strokeLinecap="round" />
    </motion.g>
  );
}

function Orb({ path, color, begin, dur = 1.6, gap = 0 }: { path: string; color: string; begin: number; dur?: number; gap?: number }) {
  const cycle = dur + gap;
  const kt = gap > 0 ? `0;${(dur / cycle).toFixed(3)};1` : "0;1";
  const kp = gap > 0 ? "0;1;1" : "0;1";
  const op = gap > 0 ? `0;1;1;0;0` : "0;1;1;0";
  const opt = gap > 0 ? `0;0.05;${(dur / cycle - 0.05).toFixed(3)};${(dur / cycle).toFixed(3)};1` : "0;0.08;0.85;1";
  return (
    <g style={{ filter: `drop-shadow(0 0 6px ${color})` }}>
      {[0, 0.09, 0.18].map((d, i) => (
        <circle key={i} r={7.5 - i * 2.2} fill={color} opacity={0}>
          <animateMotion dur={`${cycle}s`} begin={`${begin + d}s`} repeatCount="indefinite" path={path} keyPoints={kp} keyTimes={kt} calcMode="linear" />
          <animate attributeName="opacity" values={op} keyTimes={opt} dur={`${cycle}s`} begin={`${begin + d}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

/** The dashboard's story: servers, balancer, hosts, bundle, client, traffic, a node falling asleep. Drawn with the panel's own colors. */
export function WelcomeStory({ player, captionKeys, compact }: { player: ScenePlayer; captionKeys: string[]; compact?: boolean }) {
  const { t } = useTranslation();
  const { step, reduce } = player;
  const lab = (k: string) => t(`pages.help.scenes.common.${k}`);
  const asleepB = step === 6;
  const hubLook = step === 5 ? { x: 2.4, y: -1.5 } : step === 6 ? { x: 2.4, y: -2.4 } : { x: 0, y: 0 };
  const dynamic = !reduce;

  return (
    <div>
      <div
        className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-[var(--border)]"
        style={{ background: "linear-gradient(180deg, color-mix(in oklab, var(--bg-elevated) 70%, var(--accent)) 0%, var(--bg) 78%)" }}
        role="img"
        aria-label={lab("bundle")}
      >
        <svg viewBox="0 0 800 450" className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="hubShine" cx="35%" cy="28%" r="70%">
              <stop offset="0%" stopColor="#fff" stopOpacity={0.35} />
              <stop offset="60%" stopColor="#fff" stopOpacity={0} />
            </radialGradient>
            <radialGradient id="spot" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
            </radialGradient>
          </defs>

          {/* sky: glow, stars, clouds */}
          <ellipse cx={400} cy={150} rx={360} ry={150} fill="url(#spot)" />
          {[[60, 40], [180, 90], [300, 30], [520, 46], [610, 96], [740, 40], [470, 124], [90, 150]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={1.8 + (i % 3) * 0.5} style={{ fill: "var(--fg)" }} opacity={0.5}>
              {dynamic ? <animate attributeName="opacity" values="0.15;0.75;0.15" dur={`${2.4 + (i % 4) * 0.7}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" /> : null}
            </circle>
          ))}
          {[[140, 70, 1], [560, 60, 0.8]].map(([x, y, s], i) => (
            <g key={i} opacity={0.16} style={{ fill: "var(--fg)" }} transform={`translate(${x} ${y}) scale(${s})`}>
              <ellipse cx={0} cy={0} rx={46} ry={13} />
              <ellipse cx={-18} cy={-9} rx={22} ry={13} />
              <ellipse cx={14} cy={-11} rx={26} ry={15} />
              {dynamic ? <animateTransform attributeName="transform" type="translate" values="0 0;26 0;0 0" dur={`${22 + i * 8}s`} repeatCount="indefinite" additive="sum" /> : null}
            </g>
          ))}

          {/* ground */}
          <path d="M -20 392 Q 400 372 820 392 L 820 470 L -20 470 Z" style={{ fill: "color-mix(in oklab, var(--bg) 82%, var(--accent))" }} />
          <path d="M -20 392 Q 400 372 820 392" fill="none" style={{ stroke: "color-mix(in oklab, var(--accent) 40%, transparent)" }} strokeWidth={2} />

          {/* dotted routes */}
          <g fill="none" strokeWidth={3} strokeLinecap="round" strokeDasharray="2 10" style={{ stroke: "var(--fg-subtle)" }} opacity={0.55}>
            {step >= 1 ? <path d={PATH_HUB_A} /> : null}
            {step >= 1 ? <path d={PATH_HUB_B} /> : null}
            {step >= 4 ? <path d={PATH_PHONE_HUB} /> : null}
          </g>

          {/* nodes */}
          <Tower cx={TOWER_A.x} base={TOWER_A.base} asleep={false} label={lab("nodeA")} delay={0} />
          <Tower cx={TOWER_B.x} base={TOWER_B.base} asleep={asleepB} label={lab("nodeB")} delay={0.12} />

          {/* balancer */}
          {step >= 1 ? <Hub label={lab("balancer")} look={hubLook} /> : null}

          {/* hosts */}
          {step >= 2 ? (
            <>
              <Signpost x={HUB.x} y={HUB.base + 84} text="lb.example.com" delay={0} />
              <Signpost x={TOWER_A.x} y={TOWER_A.base + 60} text="a.example.com" delay={0.25} />
              <Signpost x={TOWER_B.x} y={TOWER_B.base + 58} text="b.example.com" delay={0.5} />
            </>
          ) : null}

          {/* bundle + tags flying in */}
          {step >= 3 ? <Box label={lab("bundle")} play={step === 3} /> : null}
          {step === 3 ? (
            <>
              <Tag from={{ x: HUB.x, y: HUB.base + 70 }} delay={0.9} text="lb.example.com" />
              <Tag from={{ x: TOWER_A.x, y: TOWER_A.base + 42 }} delay={1.35} text="a.example.com" />
              <Tag from={{ x: TOWER_B.x, y: TOWER_B.base + 40 }} delay={1.8} text="b.example.com" />
            </>
          ) : null}

          {/* client + subscription ticket */}
          {step >= 4 ? <Phone label={lab("client")} happy={step >= 4} waving={step >= 4} /> : null}
          {step === 4 ? <Ticket key="ticket" /> : null}

          {/* traffic */}
          {step >= 5 && dynamic ? (
            <>
              <Orb path={PATH_PHONE_HUB} color={SKY} begin={0} dur={1.5} gap={1.7} />
              {step === 5 ? (
                <>
                  <Orb path={PATH_HUB_A} color={GREEN} begin={1.2} dur={1.4} gap={1.8} />
                  <Orb path={PATH_HUB_B} color={GREEN} begin={2.8} dur={1.4} gap={1.8} />
                </>
              ) : (
                <>
                  <Orb path={PATH_HUB_A} color={GREEN} begin={1.2} dur={1.4} gap={0} />
                </>
              )}
            </>
          ) : null}
        </svg>
      </div>
      <ScenePlayerBar player={player} caption={t(captionKeys[Math.min(step, captionKeys.length - 1)])} compact={compact} />
    </div>
  );
}
