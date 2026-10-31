// Site settings. The Supabase URL and anon key are safe to publish:
// all access is controlled by the rules in supabase/schema.sql.
// Leave them empty to run the site in demo mode with sample data.
export const CONFIG = {
  siteName: 'TeamMG Esports',
  whatsappGroup: 'https://chat.whatsapp.com/HZrLR0uH3BgJH1Zapbz6yn',
  // UPI details for paid matches (entry fee above ₹0). A UPI business ID
  // works best: some apps limit pay links to personal UPI IDs.
  upiId: 'deepakgandla@ybl',
  upiName: 'TeamMG Esports',
  // YouTube channel for subscriber-only matches (full link, e.g. https://www.youtube.com/@teammg).
  youtubeChannel: 'https://www.youtube.com/@TeamMGYT',
  supabaseUrl: 'https://jbhjgzagntyniuvwgbhg.supabase.co',
  supabaseAnonKey: 'sb_publishable_CfcEqORa54NJwkttWImcsg_yONFBsjm',
};
