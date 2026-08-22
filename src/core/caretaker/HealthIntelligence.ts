/**
 * ==========================================================
 * LÉLU
 * CARETAKER HEALTH INTELLIGENCE
 *
 * Caretaker's comprehensive health, wellness, biomedical
 * research, pharmacology, biotechnology and bioengineering
 * intelligence layer. This is NOT a disconnected medical
 * assistant and NOT a clinician:
 *
 *   - it grades evidence objectively (traditional ≠ proven)
 *   - it separates health INFORMATION from clinical DECISION-MAKING
 *   - it protects personal health information via the existing
 *     information firewall (PromptInjectionGuard)
 *   - it redirects dangerous experimentation toward literature,
 *     computational modeling and safety analysis
 *
 * It plugs into the ONE LÉLU cognition/memory path: the result
 * of a consult is context, and any durable knowledge that forms
 * is stored through the existing memory path — never a parallel
 * medical memory.
 * ==========================================================
 */

import PromptInjectionGuard from "../security/PromptInjectionGuard";

export type EvidenceGrade =
  | "traditional"
  | "plausible"
  | "preliminary"
  | "strong"
  | "established"
  | "unknown";

export interface EvidenceLevel {
  id: EvidenceGrade;
  label: string;
  description: string;
}

/** Evidence taxonomy — the objective scale Caretaker uses. */
export const EVIDENCE_LEVELS: EvidenceLevel[] = [
  { id: "traditional", label: "Traditional practice", description: "Established within a traditional system; may or may not have modern evidence." },
  { id: "plausible", label: "Plausible mechanism", description: "A biologically plausible mechanism exists, but outcome evidence is limited." },
  { id: "preliminary", label: "Preliminary evidence", description: "Early, small, observational or limited studies suggest an effect." },
  { id: "strong", label: "Strong evidence", description: "Consistent results across multiple well-designed studies / systematic reviews." },
  { id: "established", label: "Established medical guidance", description: "Consensus guideline or well-established clinical standard of care." },
  { id: "unknown", label: "Unknown", description: "Insufficient or conflicting evidence to grade." },
];

export type HealthDomain =
  | "wellness"
  | "holistic"
  | "biomedical"
  | "pharmacology"
  | "biotechnology"
  | "bioengineering"
  | "nutrition"
  | "mental-health";

interface HealthTopic {
  id: HealthDomain;
  label: string;
  pattern: RegExp;
  defaultGrade: EvidenceGrade;
  guidance: string;
}

const HEALTH_TOPICS: HealthTopic[] = [
  {
    id: "wellness",
    label: "Wellness & lifestyle",
    pattern: /\b(sleep|exercise|stress|hydration|recovery|preventive|routine|wellness|fitness|mobility)\b/i,
    defaultGrade: "preliminary",
    guidance: "Lifestyle and preventive factors are contextual — separate evidence from individual goals.",
  },
  {
    id: "holistic",
    label: "Holistic & traditional health",
    pattern: /\b(holistic|ayurveda|tcm|traditional chinese|herbal|adaptogen|acupuncture|meditation|yoga|mind-?body|supplement)\b/i,
    defaultGrade: "traditional",
    guidance: "Traditional systems may hold useful practice; grade each claim independently against modern evidence.",
  },
  {
    id: "nutrition",
    label: "Nutrition science",
    pattern: /\b(nutrition|diet|vitamin|mineral|macronutrient|micronutrient|calorie|fasting|food)\b/i,
    defaultGrade: "preliminary",
    guidance: "Nutrition evidence is often correlational — distinguish correlation from causation.",
  },
  {
    id: "biomedical",
    label: "Biomedical science",
    pattern: /\b(anatomy|physiology|biochemistry|cell biology|molecular|genetics|genomics|immunology|microbiolog|neuroscien|endocrin|pathophysiology|epidemiology|toxicology)\b/i,
    defaultGrade: "established",
    guidance: "Foundational biomedical science — explain at the level the user needs, and flag where the field is still uncertain.",
  },
  {
    id: "pharmacology",
    label: "Pharmacology",
    pattern: /\b(drug|medication|pharmac|dose|dosage|contraindicat|adverse effect|interaction|mechanism of action|pharmacokinetic|pharmacodynamic|clinical trial)\b/i,
    defaultGrade: "established",
    guidance: "Explain medications for education; never prescribe, diagnose, or make individualized medication changes.",
  },
  {
    id: "biotechnology",
    label: "Biotechnology",
    pattern: /\b(biotech|genetic engineering|crispr|synthetic biology|proteomics|bioinformatics|biomanufacturing|biomaterial|regenerative medicine|cell engineering)\b/i,
    defaultGrade: "plausible",
    guidance: "Biotechnology is fast-moving — prioritize literature, computational modeling, and safe engineering planning.",
  },
  {
    id: "bioengineering",
    label: "Bioengineering",
    pattern: /\b(bioengineering|tissue engineering|biomedical device|diagnostic|implant|prosthetic|microfluidic|organ-?on-?a-?chip|computational biology)\b/i,
    defaultGrade: "plausible",
    guidance: "Translate biological problems into engineering problems; model and simulate before any physical work.",
  },
  {
    id: "mental-health",
    label: "Mental health",
    pattern: /\b(mental health|depression|anxiety|therapy|trauma|psycholog|well-?being|mood)\b/i,
    defaultGrade: "preliminary",
    guidance: "Mental-health information is sensitive — provide support and information, and encourage qualified professional care when appropriate.",
  },
];

const BIOHAZARD_PATTERNS = [
  /(weaponiz|bioweapon|lethal toxin|gain-?of-?function pathogen|engineer a (pathogen|virus|bacteria)|synthesize a (virus|pathogen)|biological weapon)/i,
  /(release a pathogen|infectious agent for harm|biosecurity breach)/i,
];

const HEALTH_PII_PATTERNS: { pattern: RegExp; kind: string }[] = [
  { pattern: /\b(diagnos|symptom|condition)\b/i, kind: "symptoms/diagnoses" },
  { pattern: /\b(medication|prescription|dose|mg|dosage)\b/i, kind: "medications" },
  { pattern: /\b(test result|lab result|blood test|imaging|mri|ct scan)\b/i, kind: "test results" },
  { pattern: /\b(genetic|dna|genome|mutation)\b/i, kind: "genetic information" },
  { pattern: /\b(insurance|provider|specialist|appointment)\b/i, kind: "insurance/provider information" },
];

export interface CaretakerConsultation {
  domain: HealthDomain | "general";
  domainLabel: string;
  evidenceGrade: EvidenceGrade;
  framing: string;
  workflow?: string[];
  safetyNote?: string;
}

export interface HealthDataAssessment {
  isHealthData: boolean;
  kinds: string[];
  note: string;
}

const BIOENGINEERING_WORKFLOW = [
  "Question / objective",
  "Literature review",
  "Biological understanding",
  "Engineering requirements",
  "Computational model",
  "Simulation",
  "Risk analysis",
  "Expert / ethics review",
  "Authorized research plan",
  "Validation",
  "Learning",
];

export default class HealthIntelligence {
  private static instance: HealthIntelligence | null = null;

  public static getInstance(): HealthIntelligence {
    if (!HealthIntelligence.instance) {
      HealthIntelligence.instance = new HealthIntelligence();
    }
    return HealthIntelligence.instance;
  }

  /** Which health domain (if any) a request belongs to. */
  public classifyDomain(text: string): HealthTopic | undefined {
    return HEALTH_TOPICS.find((topic) => topic.pattern.test(text));
  }

  /** Heuristic evidence grade for a claim (objective, never overconfident). */
  public classifyEvidence(text: string): EvidenceGrade {
    if (/\b(guideline|standard of care|consensus|proven|established)\b/i.test(text)) {
      return "established";
    }
    if (/\b(systematic review|meta-?analysis|strong evidence|multiple trials|rct)\b/i.test(text)) {
      return "strong";
    }
    if (/\b(preliminary|suggests|may|early|observational|small study|correlat)\b/i.test(text)) {
      return "preliminary";
    }
    if (/\b(traditional|ayurveda|tcm|folk|herbal|used for centuries)\b/i.test(text)) {
      return "traditional";
    }
    if (/\b(mechanism|plausible|pathway|theory|hypothes)\b/i.test(text)) {
      return "plausible";
    }
    return "unknown";
  }

  /** Produce Caretaker's consultation for a request. */
  public consult(text: string): CaretakerConsultation {
    const topic = this.classifyDomain(text);
    const biohazard = this.detectBiohazard(text);
    const grade = topic ? this.classifyEvidence(text) : "unknown";

    const isBioengineering = topic?.id === "bioengineering" || topic?.id === "biotechnology";
    const workflow = isBioengineering ? BIOENGINEERING_WORKFLOW : undefined;

    return {
      domain: topic?.id ?? "general",
      domainLabel: topic?.label ?? "Health & life operations",
      evidenceGrade: grade,
      framing: topic?.guidance ?? this.guardrail(),
      workflow,
      safetyNote: biohazard ?? undefined,
    };
  }

  /** Caretaker's standing boundary: information, not clinical care. */
  public guardrail(): string {
    return "Caretaker provides health information and organization support. She does not diagnose, prescribe, or make individualized medical decisions — those belong with a qualified healthcare professional.";
  }

  /** The bioengineering dream→research pipeline. */
  public researchWorkflow(): string[] {
    return [...BIOENGINEERING_WORKFLOW];
  }

  /**
   * Biosecurity boundary (M.S. Ma'at oversight). Returns a redirect note
   * when a request crosses into dangerous biological experimentation, or
   * null for legitimate research/education.
   */
  public detectBiohazard(text: string): string | null {
    if (BIOHAZARD_PATTERNS.some((pattern) => pattern.test(text))) {
      return "This objective requires professional laboratory oversight and safety procedures. Redirecting toward literature review, computational modeling, high-level design, and safety analysis instead of physical experimentation.";
    }
    return null;
  }

  /** Classify whether text contains personal health information. */
  public assessHealthData(text: string): HealthDataAssessment {
    const kinds: string[] = [];
    for (const rule of HEALTH_PII_PATTERNS) {
      if (rule.pattern.test(text) && !kinds.includes(rule.kind)) {
        kinds.push(rule.kind);
      }
    }
    return {
      isHealthData: kinds.length > 0,
      kinds,
      note:
        kinds.length > 0
          ? "Personal health information detected — classify, minimize and authorize before transmitting to external systems."
          : "No obvious personal health information detected.",
    };
  }

  /**
   * Information firewall for health data: keep only the allowed fields of
   * a structured payload before it leaves LÉLU's trust boundary.
   */
  public minimizeForExternal(payload: Record<string, unknown>, allowedKeys: string[]): Record<string, unknown> {
    return PromptInjectionGuard.getInstance().minimumContext(payload, allowedKeys);
  }
}
