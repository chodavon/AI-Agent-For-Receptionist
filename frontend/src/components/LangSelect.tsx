import type { Lang } from "../types";

interface Props {
  value: Lang;
  onChange: (lang: Lang) => void;
}

export default function LangSelect({ value, onChange }: Props) {
  return (
    <label className="lang">
      <span>Voice language</span>
      <select
        id="lang"
        value={value}
        onChange={(e) => onChange(e.target.value as Lang)}
      >
        <option value="auto">Auto-detect</option>
        <option value="en">English</option>
        <option value="km">ខ្មែរ · Khmer</option>
      </select>
    </label>
  );
}
