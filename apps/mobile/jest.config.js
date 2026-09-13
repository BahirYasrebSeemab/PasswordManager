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
  },
};
