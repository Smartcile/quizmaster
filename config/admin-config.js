// Admin Dashboard - Production Config
// Edit this file and restart container - no rebuild needed!
window.APP_CONFIG = {
  // Same-domain API via Caddy reverse proxy
  API_URL: "/api",
  WS_URL: "",  // empty = use same origin

  // Branding - change these for your event
  APP_NAME: "Smartcile Quiz",
  APP_TAGLINE: "Admin Dashboard",
  LOGO_EMOJI: "🎯",

  THEME: {
    primary: "#3498db",
    primaryDark: "#2980b9",
    accent: "#9b59b6",
    success: "#27ae60",
    danger: "#e74c3c",
    warning: "#f39c12",
    sidebarBg: "#2c3e50"
  },

  FEATURES: {
    csvImport: true,
    mediaUpload: true,
    browniePoints: true,
    whoAmI: true
  }
};
