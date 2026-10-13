// OnCue-styled sketches for the demo. They are written the way the /klose skill
// writes them: self-contained TSX against the host repo's tokens. OnCue's
// tokens are `:root` RGB triplets in index.css (--primary: 31 95 139, ...),
// which the hosted canvas reads from the folder, so the previews use
// rgb(var(--token)) and resolve to OnCue's real palette.

const T = (name, alpha) => (alpha ? `rgb(var(--${name}) / ${alpha})` : `rgb(var(--${name}))`);

export const PLAN_CARD = `import { MapPin, ArrowRight, Users } from 'lucide-react';

const t = (n, a) => a ? \`rgb(var(--\${n}) / \${a})\` : \`rgb(var(--\${n}))\`;

export default function VenueCard() {
  return (
    <div style={{ fontFamily: 'Manrope, sans-serif', width: 420 }}>
      <article style={{ background: t('card'), border: \`1px solid \${t('border')}\`, borderRadius: 20, padding: 20, boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)', color: t('foreground') }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 12, background: t('primary-soft'), color: t('primary') }}>
            <MapPin size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>Venue</h3>
            <p style={{ margin: 0, fontSize: 13, color: t('muted-foreground') }}>Offsite for 60 · Sydney · 14 Nov</p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: t('warning-soft'), color: t('warning') }}>Shortlist of 3</span>
        </header>

        <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: t('background') }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: t('muted-foreground') }}>Next action</p>
          <p style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 600 }}>Confirm the Harbour Room hold before Friday</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: t('subtle') }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, background: t('inverse'), color: t('inverse-foreground'), display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>AK</span>
            Aditya · owner
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Users size={14} /> 2 items on the day</span>
          </div>
        </div>

        <footer style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button style={{ flex: 1, padding: '10px 16px', borderRadius: 12, border: 0, background: t('primary'), color: t('primary-foreground'), fontWeight: 600, fontSize: 14, fontFamily: 'inherit', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            Open shortlist <ArrowRight size={16} />
          </button>
          <button style={{ padding: '10px 16px', borderRadius: 12, border: \`1px solid \${t('border')}\`, background: t('card'), color: t('subtle'), fontWeight: 600, fontSize: 14, fontFamily: 'inherit' }}>
            Archive
          </button>
        </footer>
      </article>
    </div>
  );
}
`;

export const RUN_SHEET = `import { Clock, Undo2, Check } from 'lucide-react';

const t = (n, a) => a ? \`rgb(var(--\${n}) / \${a})\` : \`rgb(var(--\${n}))\`;

const items = [
  { time: '11:30', name: 'Keynote', where: 'Harbour Room', state: 'now' },
  { time: '12:30', name: 'Lunch', where: 'Terrace · Catering by Fable', state: 'next', late: '+10 min' },
  { time: '13:30', name: 'Workshops', where: 'Rooms 2 & 3', state: 'later' },
  { time: '17:00', name: 'Dinner', where: 'Harbour Room', state: 'later' },
];

export default function RunSheet() {
  return (
    <div style={{ fontFamily: 'Manrope, sans-serif', width: 460, color: t('foreground') }}>
      <div style={{ background: t('background'), borderRadius: 20, overflow: 'hidden', border: \`1px solid \${t('border')}\` }}>
        <header style={{ background: t('live-soft'), padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: t('live') }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', color: t('live') }}>RUNNING</p>
            <p style={{ margin: 0, fontSize: 13, color: t('muted-foreground') }}>2 of 6 done · <b style={{ color: t('warning') }}>10 min late</b></p>
          </div>
          <button style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '8px 12px', borderRadius: 12, border: \`1px solid \${t('border')}\`, background: t('card'), color: t('subtle'), display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <Clock size={14} /> Running late
          </button>
        </header>
        <ol style={{ listStyle: 'none', margin: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <li key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderRadius: 14, background: t('card'), border: \`1px solid \${it.state === 'now' ? t('live', 0.4) : t('border')}\`, boxShadow: it.state === 'now' ? \`0 0 0 3px \${t('live-soft')}\` : 'none' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'Fraunces, serif', fontSize: 20, fontWeight: 600, width: 58, color: it.state === 'later' ? t('muted-foreground') : t('foreground') }}>{it.time}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{it.name}</p>
                <p style={{ margin: 0, fontSize: 13, color: t('muted-foreground') }}>{it.where}</p>
              </div>
              {it.state === 'now' && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: t('live') }}>NOW</span>}
              {it.late && <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: t('warning-soft'), color: t('warning') }}>{it.late}</span>}
              {it.state === 'now' && <button style={{ width: 36, height: 36, borderRadius: 999, border: 0, background: t('live'), color: '#fff', display: 'grid', placeItems: 'center' }}><Check size={18} /></button>}
            </li>
          ))}
        </ol>
        <footer style={{ padding: '4px 16px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t('muted-foreground') }}>
          <Undo2 size={14} /> Delay applied 2 min ago · <span style={{ color: t('primary'), fontWeight: 600 }}>Undo</span>
        </footer>
      </div>
    </div>
  );
}
`;

export const CUE_PANEL = `import { Sparkles, Plus } from 'lucide-react';

const t = (n, a) => a ? \`rgb(var(--\${n}) / \${a})\` : \`rgb(var(--\${n}))\`;

const suggestions = [
  { title: 'Presentations', why: 'The brief mentions a keynote: AV, a clicker and a run-through.' },
  { title: 'Transport', why: '60 guests moving between the office and the Harbour Room.' },
  { title: 'Dietary needs', why: 'Dinner for 60 without a catering note yet.' },
];

export default function CueSuggests() {
  return (
    <div style={{ fontFamily: 'Manrope, sans-serif', width: 400, color: t('foreground') }}>
      <section style={{ borderRadius: 20, border: \`1px solid \${t('cue', 0.3)}\`, background: t('cue-soft'), padding: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 999, background: t('card'), color: t('cue-ink'), display: 'grid', placeItems: 'center', border: \`1px solid \${t('cue', 0.3)}\` }}><Sparkles size={16} /></span>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Cue suggests</h3>
            <p style={{ margin: 0, fontSize: 13, color: t('subtle') }}>From the brief. Nothing is added on its own.</p>
          </div>
        </header>
        <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {suggestions.map((s) => (
            <li key={s.title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, background: t('card') }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{s.title}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: t('subtle') }}>{s.why}</p>
              </div>
              <button style={{ fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '7px 12px', borderRadius: 10, border: 0, background: t('cue-ink'), color: t('cue-foreground'), fontSize: 13, fontWeight: 600 }}><Plus size={14} /> Add</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
`;

export const BRIEF_MARKS = `const t = (n, a) => a ? \`rgb(var(--\${n}) / \${a})\` : \`rgb(var(--\${n}))\`;

const Mark = ({ kind, children }) => (
  <span style={{ background: t(\`tag-\${kind}-soft\`), borderBottom: \`2px solid \${t(\`tag-\${kind}\`)}\`, borderRadius: 4, padding: '1px 3px' }}>{children}</span>
);

export default function BriefComposer() {
  const missing = ['Start time', 'Dress code'];
  return (
    <div style={{ fontFamily: 'Manrope, sans-serif', width: 520, color: t('foreground') }}>
      <div style={{ borderRadius: 24, padding: 10, background: \`linear-gradient(135deg, \${t('primary-soft', 0.9)}, \${t('card')} 60%, \${t('cue-soft', 0.6)})\`, border: \`1px solid \${t('primary', 0.2)}\` }}>
        <div style={{ borderRadius: 18, background: t('card', 0.92), padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ fontSize: 14, fontWeight: 700 }}>Describe the event</label>
            <span style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: t('primary-soft'), color: t('primary-hover') }}>Updates as you type</span>
          </div>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.7, fontFamily: 'Fraunces, serif', fontWeight: 500 }}>
            Offsite for <Mark kind="who">60 people</Mark> in <Mark kind="where">Sydney</Mark> on <Mark kind="when">14 Nov</Mark>, budget <Mark kind="money">$20k</Mark>, a keynote and a <Mark kind="food">sit-down dinner</Mark>.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: t('muted-foreground') }}>Still missing:</span>
            {missing.map((m) => (
              <span key={m} style={{ fontSize: 12.5, fontWeight: 600, padding: '5px 10px', borderRadius: 999, border: \`1px solid \${t('cue', 0.4)}\`, color: t('cue-ink'), background: t('card') }}>{m}</span>
            ))}
            <button style={{ marginLeft: 'auto', fontFamily: 'inherit', padding: '9px 16px', borderRadius: 12, border: 0, background: t('inverse'), color: t('inverse-foreground'), fontWeight: 700, fontSize: 14 }}>Start planning</button>
          </div>
        </div>
      </div>
    </div>
  );
}
`;

const now = Date.now();
const node = (id, name, description, x, y, width, height, code, extra = {}) => ({
  id, name, description, x, y, width, height, createdAt: now - 3_600_000, updatedAt: now - 3_600_000, status: 'sketch', code, ...extra,
});

export const PROJECT_ID = '8a1b1a7e-0c3d-4f52-9b8e-3d1f6a2c9e01';

export const project = () => ({
  id: PROJECT_ID,
  name: 'OnCue · Plan & Run',
  description: 'Sketches for the Plan cards, the run sheet and Cue, against OnCue’s tokens.',
  nodes: [
    node('venue-card', 'Plan card · Venue', 'A Plan tile: status, next action, owner and the items on the day.', 80, 80, 470, 330, PLAN_CARD, {
      notes: 'Status badge takes the warning tone until a venue is confirmed. Owner avatar from the Team. "On the day" counts the linked Run items.',
    }),
    node('run-sheet', 'Run sheet · Now & next', 'The time-ordered run sheet with the live delay shown separately from planned times.', 620, 80, 510, 480, RUN_SHEET, {
      notes: 'Planned times stay as history; the delay is a separate live value with Undo. Fraunces for the times.',
    }),
    node('cue-suggests', 'Cue suggests', 'Cards Cue proposes from the brief. Gold is reserved for Cue.', 80, 470, 450, 410, CUE_PANEL),
  ],
  brandNotes: 'OnCue: plan and run an event from one brief. Calm, editorial, precise. Fraunces for display, Manrope for UI.',
  designSystemNotes: 'Tokens are roles, not hues: background, card, card-raised, foreground, subtle, muted-foreground, primary (steel blue), inverse (navy), live (green), warning, destructive. Gold (cue, cue-ink) is only for Cue. Radii: card 20px, button 12px.',
  created_at: new Date(now - 86_400_000).toISOString(),
  updated_at: new Date(now - 3_600_000).toISOString(),
});

export const agentNode = () =>
  node('brief-marks', 'Event brief · Cue’s reading', 'The brief box on Home: what Cue read, marked on your own words, and what is still missing.', 1200, 80, 580, 330, BRIEF_MARKS, {
    createdAt: Date.now(), updatedAt: Date.now(),
    notes: 'One colour per kind of detail: when, who, where, money, food. Always with a word, never colour alone.',
  });
