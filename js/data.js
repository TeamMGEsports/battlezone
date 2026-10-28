// ============================================================
//  TOURNAMENT DATA — Edit this file to add/update tournaments
//  After editing, commit & push to GitHub. Site updates instantly.
// ============================================================

const SITE_CONFIG = {
  name: "BattleZone",
  tagline: "Free BGMI & PUBG Tournaments",
  whatsappGroup: "https://chat.whatsapp.com/HZrLR0uH3BgJH1Zapbz6yn?s=cl&p=a&iam=2",
  discordLink: "",  // Optional: add your Discord server link
  adminContact: "919999999999",  // WhatsApp number for support (with country code, no +)
  upiId: "",  // Optional: for paid tournaments later
};

// STATUS: "upcoming" | "live" | "completed"
// MODE: "Solo" | "Duo" | "Squad"
// MAP: "Erangel" | "Miramar" | "Sanhok" | "Vikendi" | "Livik"
// GAME: "BGMI" | "PUBG"

const TOURNAMENTS = [
  {
    id: 1,
    title: "Friday Night Chicken Dinner 🍗",
    game: "BGMI",
    mode: "Squad",
    map: "Erangel",
    date: "2026-10-30T20:00:00+05:30",
    entryFee: "Free",
    prizePool: "₹500",
    maxTeams: 25,
    registeredTeams: 18,
    perKillPrize: "₹10",
    roomId: "12345678",
    roomPass: "bgmi123",
    status: "upcoming",
    rules: [
      "Emulator players not allowed",
      "Team captain must join the room 5 minutes before match time",
      "No teaming up with other squads — instant ban",
      "If you disconnect, no re-entry after Zone 3",
      "Captain must share screenshot of results in WhatsApp group",
      "Prize money sent via UPI within 24 hours"
    ],
    pointsSystem: {
      chickenDinner: 15,
      secondPlace: 12,
      thirdPlace: 10,
      kill: 1
    },
    results: []
  },
  {
    id: 2,
    title: "Solo Showdown 🔥",
    game: "BGMI",
    mode: "Solo",
    map: "Sanhok",
    date: "2026-10-29T21:00:00+05:30",
    entryFee: "Free",
    prizePool: "₹300",
    maxTeams: 50,
    registeredTeams: 32,
    perKillPrize: "₹5",
    roomId: "87654321",
    roomPass: "solo999",
    status: "upcoming",
    rules: [
      "Solo mode only — no teaming",
      "Join room 5 minutes before start",
      "Screenshot of final standing required",
      "Prize via UPI within 24 hours"
    ],
    pointsSystem: {
      chickenDinner: 15,
      secondPlace: 12,
      thirdPlace: 10,
      kill: 1
    },
    results: []
  },
  {
    id: 3,
    title: "Duo Warriors Cup ⚔️",
    game: "BGMI",
    mode: "Duo",
    map: "Miramar",
    date: "2026-10-28T19:30:00+05:30",
    entryFee: "Free",
    prizePool: "₹400",
    maxTeams: 25,
    registeredTeams: 25,
    perKillPrize: "₹8",
    roomId: "11223344",
    roomPass: "duo456",
    status: "completed",
    rules: [
      "Duo mode — bring your partner",
      "Join room 5 minutes before start",
      "Screenshot of final standing required"
    ],
    pointsSystem: {
      chickenDinner: 15,
      secondPlace: 12,
      thirdPlace: 10,
      kill: 1
    },
    results: [
      { rank: 1, team: "Clutch Gods", kills: 14, points: 29, prize: "₹200" },
      { rank: 2, team: "Rush Duo", kills: 11, points: 23, prize: "₹120" },
      { rank: 3, team: "Camper Kings", kills: 9, points: 19, prize: "₹80" },
      { rank: 4, team: "Spray Masters", kills: 8, points: 14, prize: "" },
      { rank: 5, team: "Noob Squad", kills: 7, points: 12, prize: "" },
    ]
  },
  {
    id: 4,
    title: "Weekend PUBG Classic 🏆",
    game: "PUBG",
    mode: "Squad",
    map: "Erangel",
    date: "2026-11-01T20:00:00+05:30",
    entryFee: "Free",
    prizePool: "₹1000",
    maxTeams: 25,
    registeredTeams: 5,
    perKillPrize: "₹15",
    roomId: "",
    roomPass: "",
    status: "upcoming",
    rules: [
      "Open for PUBG Mobile players",
      "Emulators allowed in this match",
      "Standard squad rules apply",
      "Team captain must share screenshot in group"
    ],
    pointsSystem: {
      chickenDinner: 15,
      secondPlace: 12,
      thirdPlace: 10,
      kill: 1
    },
    results: []
  }
];
