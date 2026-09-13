const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Re-wired: tailwindcss was downgraded to ^3.4 (NativeWind 4's actual
// target — it previously threw "NativeWind only supports Tailwind CSS v3"
// against the tailwindcss@4.3.3 that was installed at the time). Verified
// working via `bun x expo export` before this file was restored.
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
