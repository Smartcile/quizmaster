// Quiz Master - Runtime Configuration
// Edit this file to customize without rebuilding the Docker image.
// In Docker, mount this file from host: -v ./config/admin-config.js:/app/dist/config.js:ro

window.APP_CONFIG = {
  // API endpoint - leave empty to auto-detect from current URL
  // Examples:
  //   ""                              -> http://CURRENT_HOST:5000/api (default local)
  //   "/api"                          -> Same domain (use with reverse proxy)
  //   "https://smartcile.com/api"     -> Specific URL
  API_URL: "",

  // WebSocket endpoint - leave empty to auto-detect
  // Examples:
  //   ""                              -> http://CURRENT_HOST:5000 (default local)
  //   ""                              -> Same domain (use with reverse proxy, leave empty)
  //   "https://smartcile.com"         -> Specific URL
  WS_URL: "",

  // Branding
  APP_NAME: "Quiz Master",
  APP_TAGLINE: "Admin Dashboard",
  LOGO_EMOJI: "📊",

  // Theme colors (CSS custom properties)
  THEME: {
    primary: "#3498db",
    primaryDark: "#2980b9",
    accent: "#9b59b6",
    success: "#27ae60",
    danger: "#e74c3c",
    warning: "#f39c12",
    sidebarBg: "#2c3e50"
  },

  // Features
  FEATURES: {
    csvImport: true,
    mediaUpload: true,
    browniePoints: true,
    whoAmI: true
  }
};
