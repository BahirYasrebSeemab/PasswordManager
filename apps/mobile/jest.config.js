// Jest config `transformIgnorePatterns` REPLACES (not merges with) the
// same key from a `preset`, so previously hand-writing this array here
// silently dropped jest-expo's own deliberate exclusions (e.g. the
// react-native-reanimated/babel-preset entries below) and never allowlisted
// nativewind. Instead, require jest-expo's actual preset module and extend
// its real transformIgnorePatterns array, only widening the allowlist
// portion (the first entry's negative-lookahead group) to also transform
// @noble/* (this app's crypto library) and nativewind (styling).
const jestExpoPreset = require("jest-expo/jest-preset");

const transformIgnorePatterns = jestExpoPreset.transformIgnorePatterns.map((pattern, index) => {
  if (index !== 0) {
    return pattern;
  }
  return pattern.replace("standard-navigation))", "standard-navigation|@noble|nativewind))");
});

module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // react-native-safe-area-context's useSafeAreaInsets() throws without a
    // SafeAreaProvider ancestor providing real native measurements, which
    // Jest never has. See test/mocks/react-native-safe-area-context.js for
    // why this is a hand-written mock rather than the library's own
    // jest/mock.tsx (that one is default-export-only, which breaks this
    // app's named imports).
    "^react-native-safe-area-context$": "<rootDir>/test/mocks/react-native-safe-area-context.js",
  },
};
