# BattleZone 🎮 — Free BGMI & PUBG Tournaments

A clean, mobile-first tournament website for Indian gamers. Zero entry fee, real prize money.

## Features
- 🎯 Tournament cards with countdown timers
- 🔒 Room ID & Password locked until 15 min before match
- 📲 One-tap WhatsApp registration
- 🏆 Results & points table
- 🎮 Filter by Solo / Duo / Squad / Game
- 📱 Mobile-first design (dark esports theme)
- ⚡ No frameworks, no build steps, pure HTML/CSS/JS
- 💰 Free hosting on GitHub Pages

## Quick Start

1. Fork/clone this repo
2. Edit `js/data.js` — update `SITE_CONFIG` with your WhatsApp links
3. Push to GitHub
4. Enable GitHub Pages: Settings → Pages → Source: main branch
5. Share `https://yourusername.github.io/battlezone` in your WhatsApp group!

## File Structure
```
├── index.html          # Main site
├── admin.html          # Admin guide (how to update tournaments)
├── css/
│   └── style.css       # All styles
├── js/
│   ├── data.js         # ⭐ Tournament data — EDIT THIS FILE
│   └── app.js          # App logic
└── README.md
```

## How to Add a Tournament
1. Open `js/data.js` on GitHub (click ✏️ pencil icon)
2. Copy an existing tournament block
3. Change the details
4. Commit — site updates in 1-2 minutes

## How to Post Results
1. Change `status` from `"upcoming"` to `"completed"`
2. Fill in the `results` array
3. Commit

See `admin.html` for detailed instructions and templates.

## License
Free to use. Made with ❤️ for the Indian gaming community.
