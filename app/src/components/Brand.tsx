import { Coffee } from "lucide-react";
import { logoUrl } from "../brandAssets.ts";

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="CoffeeMeet, ir al inicio">
      <span className={logoUrl ? "brand-logo" : ""}>
        {logoUrl ? <img src={logoUrl} alt="" /> : <Coffee size={21} />}
      </span>
    </a>
  );
}
