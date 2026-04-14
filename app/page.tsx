import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

const PHONE_NUMBER_DISPLAY = "+1 (208) 361-7414";
const PHONE_NUMBER_PLAIN = "12083617414";

const copy = {
  es: {
    meta: {
      title: "ONPE Bot | Resultados por WhatsApp",
      description:
        "Recibe el ultimo grafico presidencial de ONPE y nuevas actualizaciones oficiales por WhatsApp.",
    },
    brand: "ONPE Bot",
    hero: {
      eyebrow: "Resultados presidenciales por WhatsApp.",
      title: "Recibe el ultimo grafico de ONPE en tu chat.",
      description:
        "Escribe al numero y el bot responde con la imagen actual. Cuando ONPE cambia, llega otra automaticamente.",
      ctaLabel: "WhatsApp",
      ctaHint: "Escribe una vez. Quedas registrado para las proximas actualizaciones oficiales.",
    },
    metric: {
      label: "Usuarios",
      caption: "registrados ya usan el bot para seguir cambios oficiales de ONPE.",
      fallback: "Actualizaciones oficiales, enviadas automaticamente.",
    },
    steps: {
      label: "Como funciona",
      items: [
        "Escribe al numero.",
        "Recibe la imagen actual.",
        "Espera nuevas alertas cuando ONPE cambie.",
      ],
    },
    footer: {
      credit: "Hecho por Anthony",
      note: "Fuente: ONPE.",
      detail: "Un bot simple para seguir resultados sin refrescar paginas todo el dia.",
      website: "Website",
      sourceCode: "Codigo fuente",
    },
    whatsappPrefill: "Hola, quiero recibir actualizaciones de ONPE.",
  },
  en: {
    meta: {
      title: "ONPE Bot | Results over WhatsApp",
      description:
        "Get the latest ONPE presidential chart and official result updates through WhatsApp.",
    },
    brand: "ONPE Bot",
    hero: {
      eyebrow: "Presidential results over WhatsApp.",
      title: "Get the latest ONPE chart in your chat.",
      description:
        "Message the number and the bot replies with the current image. When ONPE changes, another one arrives automatically.",
      ctaLabel: "WhatsApp",
      ctaHint: "Send one message. You stay registered for the next official updates.",
    },
    metric: {
      label: "Users",
      caption: "registered people already use the bot to follow official ONPE changes.",
      fallback: "Official updates, delivered automatically.",
    },
    steps: {
      label: "How it works",
      items: [
        "Message the number.",
        "Get the current chart.",
        "Wait for a new alert when ONPE changes.",
      ],
    },
    footer: {
      credit: "Made by Anthony",
      note: "Source: ONPE.",
      detail: "A simple bot for following results without refreshing pages all day.",
      website: "Website",
      sourceCode: "Source Code",
    },
    whatsappPrefill: "Hi, I want ONPE updates.",
  },
} as const;

type Lang = keyof typeof copy;

type HomePageProps = {
  searchParams: Promise<{
    lang?: string | string[] | undefined;
  }>;
};

function getLang(value: string | string[] | undefined): Lang {
  const candidate = Array.isArray(value) ? value[0] : value;

  return candidate === "en" ? "en" : "es";
}

function getLanguageHref(lang: Lang) {
  return lang === "es" ? "/" : "/?lang=en";
}

function getWhatsappHref(lang: Lang) {
  return `https://wa.me/${PHONE_NUMBER_PLAIN}?text=${encodeURIComponent(copy[lang].whatsappPrefill)}`;
}

function formatCount(value: number, lang: Lang) {
  return new Intl.NumberFormat(lang === "es" ? "es-PE" : "en-US").format(value);
}

async function getTotalUsers() {
  try {
    const [{ getDb }, { whatsappSenders }, { sql }] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);

    const db = getDb();
    const rows = await db
      .select({
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(whatsappSenders);

    const count = Number(rows[0]?.count);

    return Number.isFinite(count) ? count : null;
  } catch (error) {
    console.error("Failed to load WhatsApp sender count", error);

    return null;
  }
}

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const lang = getLang((await searchParams).lang);
  const content = copy[lang];

  return {
    title: content.meta.title,
    description: content.meta.description,
  };
}

export default async function Home({ searchParams }: HomePageProps) {
  await connection();

  const lang = getLang((await searchParams).lang);
  const content = copy[lang];
  const totalUsers = await getTotalUsers();
  const whatsappHref = getWhatsappHref(lang);

  return (
    <main className="page-shell">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] hidden opacity-[0.04] md:block"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 400 400\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")',
          mixBlendMode: "overlay",
        }}
      />

      <div className="page-shell-inner">
        <header className="relative z-10 w-full">
          <div className="mx-auto flex w-full max-w-[44rem] items-center justify-between px-5 py-5 md:px-6 md:py-6">
            <Link href="/" className="font-serif text-lg leading-none text-white transition-colors hover:text-white/80 md:text-xl">
              {content.brand}
            </Link>

            <nav className="flex items-center gap-1 text-[13px] text-white/62" aria-label="Language selector">
              {(["es", "en"] as const).map((option) => {
                const isActive = option === lang;

                return (
                  <a
                    key={option}
                    href={getLanguageHref(option)}
                    aria-current={isActive ? "page" : undefined}
                    className={isActive ? "minimal-hover active" : "minimal-hover"}
                  >
                    {option.toUpperCase()}
                  </a>
                );
              })}
            </nav>
          </div>
        </header>

        <section className="relative z-10 mx-auto flex w-full max-w-[44rem] flex-1 px-5 pb-20 pt-8 md:px-6 md:pt-12" lang={lang}>
          <div className="w-full space-y-10 md:space-y-12">
            <div className="space-y-4">
              <p className="text-[13px] leading-7 text-white/42">{content.hero.eyebrow}</p>
              <h1 className="max-w-[34rem] text-[clamp(2.9rem,10vw,5rem)] leading-[0.94] tracking-[-0.07em] text-white/96">
                {content.hero.title}
              </h1>
              <p className="max-w-[34rem] text-[15px] leading-7 text-white/62">{content.hero.description}</p>
            </div>

            <div className="space-y-3">
              <p className="text-[13px] leading-7 text-white/34">{content.hero.ctaLabel}</p>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full rounded-[2rem] px-3 py-2 text-white/88 transition-colors duration-180 hover:bg-white/8 hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] md:px-4"
              >
                <span className="text-[clamp(2.25rem,8vw,4.6rem)] leading-none tracking-[-0.08em] text-white/96">
                  {PHONE_NUMBER_DISPLAY}
                </span>
              </a>
              <p className="max-w-[34rem] text-[13px] leading-6 text-white/42">{content.hero.ctaHint}</p>
            </div>

            <div className="space-y-7 pt-2">
              <div className="grid grid-cols-[72px_1fr] gap-4 md:grid-cols-[84px_1fr]">
                <p className="text-[13px] leading-9 text-white/34">{content.metric.label}</p>
                <div className="space-y-2">
                  {totalUsers !== null ? (
                    <>
                      <p className="text-[clamp(2rem,7vw,3.6rem)] leading-none tracking-[-0.08em] text-white/96">
                        {formatCount(totalUsers, lang)}
                      </p>
                      <p className="max-w-[28rem] text-[15px] leading-7 text-white/62">{content.metric.caption}</p>
                    </>
                  ) : (
                    <p className="max-w-[28rem] text-[15px] leading-7 text-white/62">{content.metric.fallback}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-[72px_1fr] gap-4 md:grid-cols-[84px_1fr]">
                <p className="text-[13px] leading-9 text-white/34">{content.steps.label}</p>
                <ul className="space-y-2.5">
                  {content.steps.items.map((item, index) => (
                    <li key={item} className="grid grid-cols-[24px_1fr] gap-3 text-[15px] leading-7 text-white/62">
                      <span className="text-white/34">{String(index + 1).padStart(2, "0")}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <footer className="relative z-10 w-full">
          <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-4 px-5 py-6 text-[13px] text-white/42 md:flex-row md:items-center md:justify-between md:px-6">
            <div className="max-w-[24rem] space-y-1">
              <p>
                {content.footer.credit}{" "}
                <a
                  href="https://www.cueva.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-white"
                >
                  (www.cueva.io)
                </a>
              </p>
              <p>
                {content.footer.note} {content.footer.detail}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:justify-end">
              <a
                href="https://www.cueva.io"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                {content.footer.website}
              </a>
              <a
                href="https://github.com/cuevaio/onpe-bot"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                {content.footer.sourceCode}
              </a>
              <a
                href="https://github.com/cuevaio"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                GitHub
              </a>
              <a
                href="https://x.com/cuevaio"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                X
              </a>
              <a
                href="https://linkedin.com/in/cuevaio"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                LinkedIn
              </a>
              <a
                href="https://instagram.com/cueva.io"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
              >
                Instagram
              </a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
