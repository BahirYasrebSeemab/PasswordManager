import { sendMessage } from "../messaging/client";
import { isEligiblePageUrl } from "../shared/matching";
import { startController } from "./controller";
import { isTopOrSameOriginFrame } from "./frames";
import { createOverlay } from "./overlay";

// HTTPS pages (and localhost) only; top frame and same-origin iframes only.
if (isEligiblePageUrl(location.href) && isTopOrSameOriginFrame()) {
  startController({
    send: sendMessage,
    overlay: createOverlay(),
    // Only the top window shows the save banner; iframes just report submissions.
    checkPendingOnStart: window === window.top,
  });
}
