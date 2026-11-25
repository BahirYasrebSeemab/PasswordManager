// Minimal Jest mock for react-native-safe-area-context.
//
// useSafeAreaInsets() needs a real SafeAreaProvider ancestor with actual
// native frame measurements, which Jest never provides — it throws without
// one. The library ships its own jest/mock.tsx, but that file is
// default-export-only (`export default {...}`), which doesn't satisfy this
// app's named imports (`import { useSafeAreaInsets } from "..."`) under
// Babel's ES-module interop — named imports don't reach into a default
// export's properties. This mock uses plain CommonJS named exports instead,
// which named imports resolve correctly. Tests don't need real inset
// values, just zero, so components that call the hook don't throw.
const React = require("react");

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const ZERO_FRAME = { x: 0, y: 0, width: 0, height: 0 };

module.exports = {
  SafeAreaProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  SafeAreaView: ({ children }) => React.createElement(React.Fragment, null, children),
  useSafeAreaInsets: () => ZERO_INSETS,
  useSafeAreaFrame: () => ZERO_FRAME,
  initialWindowMetrics: { insets: ZERO_INSETS, frame: ZERO_FRAME },
};
