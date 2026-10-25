import { CATEGORY_INFO, INCIDENT_CATEGORIES, type IncidentCategory } from './enums';

/**
 * Assistive, rule-based category suggestion for incident reports.
 *
 * It only SUGGESTS: the student always confirms or changes the category, and committees can
 * re-route. It never dismisses a report or makes any decision about a person. Keeping it
 * deterministic and explainable (the matched phrases are returned) makes it auditable.
 */
const KEYWORDS: Record<Exclude<IncidentCategory, 'other'>, [string, number][]> = {
  ragging: [['ragging', 5], ['ragged', 5], ['senior', 2], ['seniors', 2], ['fresher', 2], ['freshers', 2], ['junior', 1], ['forced to', 2], ['made us', 2], ['intro', 1], ['bullied', 2], ['bully', 2], ['humiliat', 2], ['hostel corridor', 1]],
  harassment: [['harass', 4], ['sexual', 4], ['touched', 3], ['groped', 5], ['stalk', 4], ['followed me', 3], ['inappropriate', 2], ['catcall', 3], ['comments about my body', 4], ['unwanted', 3], ['molest', 5]],
  discrimination: [['discriminat', 5], ['caste', 4], ['religion', 3], ['racist', 4], ['racism', 4], ['gender bias', 4], ['disability', 3], ['excluded because', 3], ['slur', 3], ['treated differently', 3]],
  academic: [['exam', 3], ['marks', 3], ['grade', 3], ['grading', 3], ['professor', 2], ['faculty', 2], ['attendance', 2], ['assignment', 2], ['evaluation', 3], ['internal', 1], ['plagiarism', 3], ['result', 2]],
  hostel: [['hostel', 3], ['warden', 3], ['mess', 3], ['room', 1], ['roommate', 2], ['curfew', 2], ['hostel food', 3], ['water supply', 2]],
  transport: [['bus', 3], ['driver', 3], ['transport', 4], ['shuttle', 3], ['vehicle', 2], ['rash driving', 4], ['overcrowded', 2], ['bus stop', 2]],
  cyber_abuse: [['instagram', 3], ['whatsapp', 3], ['online', 2], ['fake profile', 5], ['impersonat', 4], ['morphed', 5], ['photos leaked', 5], ['blackmail', 4], ['cyber', 4], ['hacked', 3], ['messages threatening', 3], ['dm', 1], ['social media', 3]],
  security: [['theft', 4], ['stolen', 4], ['robbed', 5], ['assault', 5], ['attacked', 5], ['fight', 3], ['trespass', 4], ['stranger', 3], ['knife', 5], ['weapon', 5], ['drunk', 2], ['drugs', 3], ['threat', 3], ['broke into', 4]],
  infrastructure: [['light', 2], ['lights', 2], ['dark', 2], ['broken', 2], ['leak', 3], ['wiring', 4], ['electric', 3], ['lift', 2], ['elevator', 3], ['pothole', 3], ['ceiling', 3], ['fire exit', 4], ['collapsed', 4], ['cctv', 2]],
};

/** Phrases suggesting immediate danger — the app nudges the student towards SOS / calling. */
const URGENT = ['right now', 'happening now', 'still here', 'following me now', 'bleeding', 'injured', 'knife', 'weapon', 'trapped', 'locked in', 'fire', 'can\'t breathe', 'unconscious'];
/** Phrases suggesting the student may be at risk of self-harm — the app shows crisis support first. */
const CRISIS = ['kill myself', 'suicide', 'end my life', 'self harm', 'self-harm', 'hurt myself', 'want to die', 'no reason to live'];

export interface CategorySuggestion {
  category: IncidentCategory;
  label: string;
  /** 0–1. Below ~0.35 the app presents it as "Not sure — please choose". */
  confidence: number;
  matched: string[];
  alternatives: { category: IncidentCategory; label: string; score: number }[];
  looksUrgent: boolean;
  showCrisisSupport: boolean;
  disclaimer: string;
}

export function suggestIncidentCategory(text: string): CategorySuggestion {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const scores = INCIDENT_CATEGORIES.filter((c) => c !== 'other').map((c) => {
    const hits = KEYWORDS[c as Exclude<IncidentCategory, 'other'>].filter(([k]) => t.includes(k));
    return { category: c, score: hits.reduce((a, [, w]) => a + w, 0), matched: hits.map(([k]) => k) };
  });
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]!;
  const second = scores[1]?.score ?? 0;
  const total = scores.reduce((a, s) => a + s.score, 0);
  const useOther = best.score < 3;
  const category: IncidentCategory = useOther ? 'other' : best.category;
  // Confidence grows with the winning margin and the amount of evidence.
  const confidence = useOther ? 0.2 : Math.min(0.95, (best.score - second) / Math.max(total, 1) * 0.6 + Math.min(best.score, 10) / 10 * 0.4);
  return {
    category,
    label: CATEGORY_INFO[category].label,
    confidence: Math.round(confidence * 100) / 100,
    matched: useOther ? [] : best.matched,
    alternatives: scores.filter((s) => s.score > 0 && s.category !== category).slice(0, 2).map((s) => ({ category: s.category, label: CATEGORY_INFO[s.category].label, score: s.score })),
    looksUrgent: URGENT.some((k) => t.includes(k)),
    showCrisisSupport: CRISIS.some((k) => t.includes(k)),
    disclaimer: 'This is an automatic suggestion based on the words you used. Please check it — you choose the category, and the case team can re-route it.',
  };
}
