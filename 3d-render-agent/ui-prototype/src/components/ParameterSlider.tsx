function clampParameter(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function ParameterSlider({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const updateValue = (nextValue: number) => onChange(clampParameter(nextValue));

  return (
    <div className="parameter-card">
      <div className="parameter-label">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        aria-label={label}
        onChange={(event) => updateValue(Number(event.target.value))}
      />
      <div className="parameter-stepper">
        <button type="button" onClick={() => updateValue(value - 5)} aria-label={`${label} -5%`}>
          −
        </button>
        <input
          type="number"
          min="0"
          max="100"
          value={value}
          aria-label={`${label} value`}
          onChange={(event) => updateValue(Number(event.target.value) || 0)}
        />
        <button type="button" onClick={() => updateValue(value + 5)} aria-label={`${label} +5%`}>
          +
        </button>
      </div>
    </div>
  );
}
