# Measuring and experiments

SEO changes are slow, noisy and confounded. Measuring honestly is what separates learning from guessing.

## What the numbers mean
- **Impressions** show demand and visibility. **Position** is an average across queries and devices, so it can move without any real change when new queries appear. **CTR** is clicks divided by impressions and depends heavily on position and snippet.
- Search Console data lags by a couple of days and is sampled and anonymised for rare queries.
- Always compare **equal windows** (28 days vs the previous 28, or the same period last year). Weekdays and seasonality matter.
- Do not judge pages with very few impressions; the numbers are noise.

## Brand vs non-brand
Brand searches show that people already know you. Growth in **non-brand** impressions and clicks is the real sign of search visibility improving. Track them separately.

## Running an experiment
1. Pick pages with enough impressions for a change to show (dozens per day is better than a handful).
2. Change **one thing**: a title, a description, an intro, an internal-link block.
3. **Log** it with the date (`run experiments add <url> "what changed"`).
4. Wait for the after-window to complete. The tool compares the 14 days after (starting 3 days later) with the 14 days before.
5. Read the result as **directional**: there is no control group, so seasonality, news and other changes can explain a shift.
6. Repeat on similar pages before generalising. One win on one page is a hint, not a rule.

## Better evidence when you can get it
- Split similar pages into a changed group and an unchanged control group and compare the groups, not before vs after.
- Roll out gradually (a batch at a time) and keep the rest as a comparison.

## Reporting
Say what changed, the dates, the metric, the size of the difference and the caveats. Never claim causation from a single before/after on one page, and never report a ranking guarantee.
