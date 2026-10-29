import { KEY_LABELS, stepChoice } from "../camera/settings.ts";
import type {
  CameraKey,
  CameraSettings,
  ChoiceLists,
} from "../camera/settings.ts";
import type { Config } from "../config.ts";
import type { Detection, QualityMetrics } from "../types.ts";

export type Defect =
  "no_coin" | "coin_cut_off" | "underexposed" | "overexposed" | "blurry";
export type Feature = "detection" | "exposure" | "sharpness";
export type Finding = { defect: Defect; feature: Feature; message: string };
export type Thresholds = Config["thresholds"];
export type CorrectionStep =
  { kind: "step"; key: CameraKey; direction: 1 | -1 } | { kind: "autofocus" };
export type Rule =
  | {
      defect: "no_coin" | "coin_cut_off";
      feature: "detection";
      when: "not_found" | "cut_off";
      corrections: readonly CorrectionStep[];
    }
  | {
      defect: "underexposed" | "overexposed" | "blurry";
      feature: "exposure" | "sharpness";
      metric: keyof QualityMetrics;
      op: "<" | ">";
      threshold: keyof Thresholds;
      corrections: readonly CorrectionStep[];
    };
export type CorrectionState = {
  counts: { exposure: number; sharpness: number };
  budget: { exposure: number; sharpness: number };
};
export type Plan =
  | { action: "accept" }
  | {
      action: "retry";
      feature: "exposure" | "sharpness";
      settings: CameraSettings;
      autofocus: boolean;
      note: string;
    }
  | {
      action: "menu";
      reason: "detection" | "conflict" | "limit" | "scale_end";
      hint: string;
    };

/** The single place for detection and correction (spec 6.2). Order = evaluation order: detection, exposure, sharpness. */
export const RULES: readonly Rule[] = [
  {
    defect: "no_coin",
    feature: "detection",
    when: "not_found",
    corrections: [],
  },
  {
    defect: "coin_cut_off",
    feature: "detection",
    when: "cut_off",
    corrections: [],
  },
  {
    defect: "underexposed",
    feature: "exposure",
    metric: "meanBrightness",
    op: "<",
    threshold: "minBrightness",
    corrections: [{ kind: "step", key: "exposurecompensation", direction: 1 }],
  },
  {
    defect: "overexposed",
    feature: "exposure",
    metric: "clippingRatio",
    op: ">",
    threshold: "maxClippingRatio",
    corrections: [{ kind: "step", key: "exposurecompensation", direction: -1 }],
  },
  {
    defect: "blurry",
    feature: "sharpness",
    metric: "sharpness",
    op: "<",
    threshold: "minSharpness",
    corrections: [
      { kind: "autofocus" },
      { kind: "step", key: "iso", direction: 1 },
    ],
  }, // i-th correction uses corrections[min(i, len-1)]
];

function message(defect: Defect, value: number, threshold: number): string {
  switch (defect) {
    case "no_coin":
      return "Keine Münze erkannt";
    case "coin_cut_off":
      return "Münze ragt über den Bildrand – bitte herauszoomen oder Münze mittig legen";
    case "underexposed":
      return `Helligkeit ${Math.round(value)} < ${threshold}`;
    case "overexposed":
      return `Clipping ${(value * 100).toFixed(1)} % > ${(threshold * 100).toFixed(1)} %`;
    case "blurry":
      return `Schärfe ${value.toFixed(1)} < ${threshold}`;
  }
}

export function evaluateShot(
  shot: { detection: Detection; quality: QualityMetrics | null },
  t: Thresholds,
): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if ("when" in rule) {
      const d = shot.detection;
      const hit = rule.when === "not_found" ? !d.found : d.found && d.cutOff;
      if (hit)
        return [
          {
            defect: rule.defect,
            feature: rule.feature,
            message: message(rule.defect, 0, 0),
          },
        ];
    } else if (shot.quality) {
      const value = shot.quality[rule.metric],
        limit = t[rule.threshold];
      if (rule.op === "<" ? value < limit : value > limit)
        findings.push({
          defect: rule.defect,
          feature: rule.feature,
          message: message(rule.defect, value, limit),
        });
    }
  }
  return findings;
}

export function newCorrectionState(cfg: Config): CorrectionState {
  const n = cfg.corrections.maxAutoPerFeature;
  return {
    counts: { exposure: 0, sharpness: 0 },
    budget: { exposure: n, sharpness: n },
  };
}

/** Pure: decides the next step. The caller increments `state.counts` when it follows a `retry`. */
export function planNext(
  findings: Finding[],
  settings: CameraSettings,
  choices: ChoiceLists,
  state: CorrectionState,
  steps: Config["corrections"]["steps"],
): Plan {
  const first = findings[0];
  if (!first) return { action: "accept" };
  if (findings.some((f) => f.feature === "detection"))
    return {
      action: "menu",
      reason: "detection",
      hint: "Münze zurechtlegen (ggf. herauszoomen)",
    };
  const defects = new Set(findings.map((f) => f.defect));
  if (defects.has("underexposed") && defects.has("overexposed"))
    return {
      action: "menu",
      reason: "conflict",
      hint: "Unterbelichtet und geclippt zugleich – Licht/Reflexe prüfen",
    };
  const feature = first.feature as "exposure" | "sharpness";
  if (state.counts[feature] >= state.budget[feature])
    return {
      action: "menu",
      reason: "limit",
      hint: `Maximal ${state.budget[feature]} automatische Korrekturen für ${feature === "exposure" ? "Belichtung" : "Schärfe"} erreicht`,
    };
  const rule = RULES.find((r) => r.defect === first.defect)!;
  const correction =
    rule.corrections[
      Math.min(state.counts[feature], rule.corrections.length - 1)
    ]!;
  if (correction.kind === "autofocus")
    return {
      action: "retry",
      feature,
      settings: { ...settings },
      autofocus: true,
      note: "Autofokus neu auslösen",
    };
  const { key, direction } = correction;
  const next = stepChoice(
    choices[key],
    settings[key],
    direction * ((steps as Record<string, number>)[key] ?? 1),
  );
  if (next === null)
    return {
      action: "menu",
      reason: "scale_end",
      hint: `${KEY_LABELS[key]}: Ende der Skala erreicht (${settings[key]})`,
    };
  return {
    action: "retry",
    feature,
    settings: { ...settings, [key]: next },
    autofocus: false,
    note: `${KEY_LABELS[key]} ${settings[key]} → ${next}`,
  };
}
