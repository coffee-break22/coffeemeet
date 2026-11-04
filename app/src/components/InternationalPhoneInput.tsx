import { useMemo, useState } from "react";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import { isValidWhatsAppPhone, normalizePhone } from "../domain/coffeemeet.ts";

const names = new Intl.DisplayNames(["es"], { type: "region" });
const flag = (country: string) =>
  country.replace(/./g, (letter) =>
    String.fromCodePoint(127397 + letter.charCodeAt(0)),
  );

export function InternationalPhoneInput({
  value,
  onChange,
  id = "whatsapp",
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const trimmed = value.trim(),
    normalized = trimmed.startsWith("+")
      ? `+${trimmed.slice(1).replace(/\D/g, "")}`
      : normalizePhone(value),
    parsed = parsePhoneNumberFromString(normalized),
    initialCountry = parsed?.country ?? "CO";
  const [country, setCountry] = useState<CountryCode>(initialCountry),
    callingCode = "+" + getCountryCallingCode(country),
    national =
      parsed?.country === country
        ? parsed.nationalNumber
        : normalized.startsWith(callingCode)
          ? normalized.slice(callingCode.length)
          : "",
    invalid = Boolean(value && !isValidWhatsAppPhone(value));
  const countries = useMemo(
    () =>
      getCountries()
        .map((code) => ({
          code,
          name: names.of(code) ?? code,
          dial: "+" + getCountryCallingCode(code),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [],
  );
  return (
    <div className="international-phone">
      <select
        aria-label="País y código telefónico"
        value={country}
        onChange={(event) => {
          const next = event.target.value as CountryCode;
          setCountry(next);
          onChange("+" + getCountryCallingCode(next) + national);
        }}
      >
        {countries.map((option) => (
          <option key={option.code} value={option.code}>
            {flag(option.code)} {option.name} {option.dial}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="300 123 4567"
        value={national}
        maxLength={20}
        onChange={(event) =>
          onChange(callingCode + event.target.value.replace(/\D/g, ""))
        }
        aria-invalid={invalid}
        aria-describedby={id + "-help"}
      />
      <small id={id + "-help"} className={invalid ? "field-error" : undefined}>
        Selecciona el país y escribe el número de WhatsApp.
      </small>
    </div>
  );
}
