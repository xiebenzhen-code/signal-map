# Signal Map — Signal Observatory

## Product feeling

Signal Map is a calm research instrument, not a news feed. It should make a person feel that the information in front of them has already been reduced, checked, and arranged with intent.

The visual language combines a bright research archive with a small amount of technical instrumentation: warm paper, ink-black type, electric-blue signal markers, orange for change, and green for verified evidence. Inspiration comes from the layout discipline and token-based DESIGN.md approach in [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md), but Signal Map must remain its own product.

## Tokens

- Canvas: `#F5F0E6` warm paper
- Surface: `#FFFDF7` light paper panel
- Ink: `#172033`
- Muted ink: `#657080`
- Signal blue: `#2457FF`
- Change orange: `#E85D2A`
- Verified green: `#137A63`
- Line: `#D9D5CA`
- Radius: 12px controls, 18px cards, 28px feature panels
- Spacing: 4px base; 8 / 12 / 16 / 24 / 32 / 48px working steps

## Typography

- Headline: system sans, 600–700 weight, tight tracking.
- Body: system sans, 400–500 weight, readable Chinese line-height.
- Technical labels: system mono, 11–12px uppercase only for taxonomy, state and time.
- Do not use heavy weight for every label or paragraph.

## Layout rules

- Mobile first: 16px side gutters, 44px minimum touch targets, fixed bottom dock with safe-area padding.
- Start each page with a concise index/eyebrow and one decisive title.
- Use a small number of strong surfaces, not repeated white cards.
- Use coordinate lines, status rails, sequence numbers and restrained color bands to express exploration.
- Evidence, source count and verification stay legible but secondary to the decision.

## Motion

- Prefer 150–220ms opacity, color and border transitions.
- No infinite decorative motion.
- Respect `prefers-reduced-motion`.

## Avoid

- Infinite-feed rhythm, dashboard charts, neon-on-black cyber clichés, generic glass cards, oversized pill overload, or imagery that competes with evidence reading.
