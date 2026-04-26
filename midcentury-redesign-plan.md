# Mid-Century Modern Redesign — Refined Personal Site

Replace the brutalist/industrial aesthetic with a sophisticated, mid-century-modern feel inspired by the Atherton Health design reference. Keep the personal tone — this is a portfolio, not a corporate landing page. Sensibility: simple, elegant, with clinical futurism in restrained moments (the dark Field Notes panel, technical eyebrows, hairline measurement-style markers).

## Decisions

- **Palette**: cream `#F5F3ED` background, walnut `#7A4B29` accent, near-black `#111` text, `#EFECE4` for section variation, dark `#111` panel for blog teaser.
- **Type**: Inter only (variable, weights 200–500). Italic light for elegance. No Playfair Display, no other serif. JetBrains Mono kept *only* for code blocks inside blog posts and small clinical eyebrow labels in the dark section.
- **Background**: subtle 60px grid pattern at ~4% opacity black lines.
- **Hero**: text-only — no image.
- **Tone**: first-person voice in About, contact links instead of CTAs.
- **Sections to remove from current site**: StatusBar, TechExpertise (skill gauges), Resume + ExperienceCard.
- **Sections to keep**: Nav, Hero, About (Manifesto), Projects, Hackathons, Footer, /blog route.
- **Reference design's dark section**: repurpose as "Field Notes" pulling 2–3 most-recent blog posts (uses dark element + naturally connects /blog to home, and is where clinical-futurism flavor lives).
- **Reference design's "How it works" 3-step, big quote, alumni-from logos**: skip — corporate language for a different audience.

## Page composition (home)

1. Nav — refined links, no buttons
2. Hero — text-only, light type, walnut accent rule
3. About — first-person paragraph, refined
4. Projects — quiet card grid
5. Hackathons — same rhythm, `#EFECE4` section bg
6. Field Notes — dark `#111` panel, recent blog posts
7. Footer — light hairline border, inline links

## Blog

Restyle `/blog` index, BlogPostLayout, and BlogCard to match. Mono persists only for code in posts.

## Files removed

- `Resume.astro`, `ExperienceCard.astro`
- `TechExpertise.astro`, `FauxGauge.astro`
- `StatusBar.astro`
- `WireframeGrid.astro`, `BracketCorners.astro`, `CrosshairMarker.astro`, `GridCell.astro`
- `data/experiences.ts`, `data/skills.ts`

## Progress

- [x] Plan file written
- [ ] Tailwind config + global styles updated (palette, font, grid bg)
- [ ] Font dependency swap (`@fontsource-variable/inter`) + BaseLayout import update + npm install
- [ ] Nav restyled
- [ ] Hero restyled
- [ ] About / Manifesto restyled
- [ ] Projects + ProjectCard restyled
- [ ] Hackathons + HackathonCard restyled
- [ ] FieldNotes (dark) section built
- [ ] Footer restyled
- [ ] Blog index + BlogPostLayout + BlogCard restyled
- [ ] `index.astro` composition updated (sections added/removed)
- [ ] Obsolete components + data files deleted
- [ ] Dev server runs cleanly
- [ ] Visual verification in Chrome (home + blog + post)
