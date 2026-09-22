import { createRoot } from "react-dom/client";
import "../popup/styles.css";
import { OptionsApp } from "./OptionsApp";

document.body.classList.add("options-page");
createRoot(document.getElementById("root")!).render(<OptionsApp />);
