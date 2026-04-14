export type DeterministicCommandAction =
  | { type: "set_chart_preference"; topCount: 3 | 5 }
  | { type: "pause_updates" }
  | { type: "resume_updates" }
  | { type: "send_latest_chart" }
  | { type: "send_help" }
  | { type: "none" };

function normalizeCommandText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function parseDeterministicCommand(input: string): DeterministicCommandAction {
  const text = normalizeCommandText(input);

  if (!text) {
    return { type: "none" };
  }

  if (
    hasAny(text, [
      /(^|\s)top\s*5($|\s)/,
      /top5/,
      /quiero.*top\s*5/,
      /manda(me)? .*top\s*5/,
      /envia(me)? .*top\s*5/,
      /recibir .*top\s*5/,
    ])
  ) {
    return { type: "set_chart_preference", topCount: 5 };
  }

  if (
    hasAny(text, [
      /(^|\s)top\s*3($|\s)/,
      /top3/,
      /quiero.*top\s*3/,
      /manda(me)? .*top\s*3/,
      /envia(me)? .*top\s*3/,
      /recibir .*top\s*3/,
    ])
  ) {
    return { type: "set_chart_preference", topCount: 3 };
  }

  if (
    hasAny(text, [
      /(^|\s)pausa($|\s)/,
      /(^|\s)stop($|\s)/,
      /no quiero updates/,
      /deja de enviar/,
      /pausa updates/,
    ])
  ) {
    return { type: "pause_updates" };
  }

  if (
    hasAny(text, [
      /(^|\s)reactiva($|\s)/,
      /(^|\s)reanuda($|\s)/,
      /(^|\s)resume($|\s)/,
      /quiero updates otra vez/,
    ])
  ) {
    return { type: "resume_updates" };
  }

  if (
    hasAny(text, [
      /ultimo chart/,
      /latest chart/,
      /manda(me)? el chart/,
      /envia(me)? la imagen/,
      /envia(me)? el chart/,
      /manda(me)? la imagen/,
    ])
  ) {
    return { type: "send_latest_chart" };
  }

  if (
    hasAny(text, [
      /que puedes hacer/,
      /(^|\s)ayuda($|\s)/,
      /(^|\s)help($|\s)/,
      /como funciona/,
      /que comandos hay/,
    ])
  ) {
    return { type: "send_help" };
  }

  return { type: "none" };
}
