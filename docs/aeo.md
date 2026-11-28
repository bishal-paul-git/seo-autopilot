# AI answer tracking (`aeo`)

Do Google's AI answers to your buyer questions mention or cite your site? The `aeo` job asks a fixed list of questions through DataForSEO, in your site's market, and records for each answer whether it names you (any alias, Arabic included), cites your domain, and which other sites it cites instead. It needs only `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`: no model API keys. Every call goes through the cost guard ([configuration.md](configuration.md#dataforseo-cost-guard)), and the run also stops at its own cap.

```json
"market": { "location_code": 2682, "language_code": "ar", "languages": ["ar", "en"] },
"aeo": {
  "prompts": [
    { "lang": "ar", "text": "..." },
    { "lang": "en", "text": "..." }
  ],
  "aliases": ["Brand name", "brand.example"],
  "mode": "ai_mode",
  "schedule": "weekly",
  "maxCostPerRunUsd": 1
}
```

| Key | Default | Meaning |
|---|---|---|
| `prompts` | required | 1 to 100 questions, up to 500 characters each. `lang` must be one of `market.languages` (default: the market's main language). Write them the way a buyer asks. |
| `aliases` | `[]` | Names to look for in answers, in any script. Arabic is compared without diacritics and with one attached prefix (و ف ب ك ل ال), so "مَنَار", "منار" and "ومنار" are the same name. The site's domain and `name` are always looked for. |
| `mode` | `ai_mode` | `ai_mode`, `ai_overview` or `llm_responses` (below). |
| `schedule` | `weekly` | `daily`, `weekly`, `monthly` or `manual`. A run before it is due does nothing unless `--force`. |
| `maxCostPerRunUsd` | `1` | Hard stop for one run. The next prompt is skipped when it could pass the cap. |

A bad mode, schedule, language (not in the market), empty prompt or unknown key fails loudly when the config is loaded; a site without a `market` cannot run the job.

Run it: `npx seo-autopilot run aeo [--mode ai_overview] [--limit 5] [--lang ar] [--force] [--max-cost 0.3]`. It writes `aeo.json` (answers, per-question rows, history) and `aeo.md` in the state folder. The report states the cost **measured from the API responses**, not an estimate. The engine is also available as `dataforseo` in `src/lib/ai-engines.mjs` (and in `research.engines` for the `ai-visibility` job; it is never started just because credentials exist).

## The three modes

| mode | DataForSEO call | what you get |
|---|---|---|
| `ai_mode` | `POST /v3/serp/google/ai_mode/live/advanced` | Google AI Mode's answer with plain source links |
| `ai_overview` | `POST /v3/serp/google/organic/live/advanced` with `load_async_ai_overview` | the AI Overview block of the results page; many source links are Google redirects |
| `llm_responses` | `POST /v3/ai_optimization/chat_gpt/llm_responses/live` with `web_search` | ChatGPT's answer and its url annotations (US-centred sources; searches the web only when the model decides to) |

Measured at Saudi Arabia (2682) with Arabic and English prompts.

## Cost

Measured 2026-11-26: `ai_mode` and `ai_overview` $0.004 per prompt; `llm_responses` $0.0013 when the model does not search the web and about $0.03 when it does (average $0.011 over 15 prompts). **25 prompts a week: about $0.10 with `ai_mode`, about $0.27 with `llm_responses` (at most about $0.75 if every answer searched).** DataForSEO changes prices; the report always shows what the run really cost.

## What it cannot tell you

An answer is one sample and AI answers change between asks (the same question repeated shared only 26 to 43 percent of its sources). Use trends over weeks, not single runs. A zero is not proof you are invisible: it is a count for your own question set.
